#!/usr/bin/env python3
"""Regenerate docs/docker-versions.md from Dockerfiles and Compose files.

The script is intentionally dependency-free (Python standard library only).
It records every image referenced by a Dockerfile ``FROM`` or a Compose
``image:`` key. A tag counts as pinned when it contains MAJOR.MINOR.PATCH
(suffixes such as ``-alpine`` are part of the tag). A sha256 digest also
counts as pinned. ``scratch`` is not a registry image.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", ".yarn", "dist", "coverage", ".next"}
EXACT_TAG = re.compile(
    r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[-._][0-9A-Za-z]+)*$"
)
DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
BRACED_VAR = re.compile(
    r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(?P<colon>:)?(?P<op>[-+?])(?P<word>[^}]*))?\}"
)
SIMPLE_VAR = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")
KEY_VALUE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_-]*)\s*:(.*)$")
BLOCK_SCALAR = re.compile(r"^[|>][+-]?$")
FROM_FLAGS = re.compile(
    r"^--[A-Za-z][A-Za-z0-9-]*(?:=\S+|(?:\s+\S+))?(?:\s+|$)"
)
ARG_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$")
STAGE_RE = re.compile(r"\s+[Aa][Ss]\s+([A-Za-z0-9_.-]+)\s*$")


class ParseError(Exception):
    pass


@dataclass
class ImageUse:
    name: str
    tag: str | None
    digest: str | None
    path: str
    line: int
    stage: str | None
    service: str


@dataclass
class ComposeService:
    name: str
    image: str | None = None
    image_line: int | None = None
    context: str | None = None
    dockerfile: str | None = None
    build_line: int | None = None
    has_build: bool = False


@dataclass
class Inventory:
    images: list[ImageUse] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def split_ref(ref: str) -> tuple[str, str | None, str | None]:
    digest = None
    if "@" in ref:
        ref, digest = ref.rsplit("@", 1)
    name = ref
    tag = None
    slash = ref.rfind("/")
    colon = ref.rfind(":")
    if colon > slash:
        name = ref[:colon]
        tag = ref[colon + 1 :]
    return name, tag or None, digest or None


def is_exact_tag(tag: str | None) -> bool:
    return bool(tag) and EXACT_TAG.fullmatch(tag) is not None


def is_pinned(name: str, tag: str | None, digest: str | None) -> bool:
    if name == "scratch":
        return True
    if digest and DIGEST_RE.fullmatch(digest):
        return True
    return is_exact_tag(tag)


def display_ref(name: str, tag: str | None, digest: str | None) -> str:
    if name == "scratch":
        ref = "scratch"
    elif tag:
        ref = f"{name}:{tag}"
    else:
        ref = f"{name}:latest"
    if digest:
        ref = f"{ref}@{digest}"
    return ref


def substitute(text: str, args: dict[str, str]) -> str:
    def lookup(name: str) -> tuple[bool, str]:
        if name not in args:
            return False, ""
        return True, args[name]

    def repl_braced(match: re.Match[str]) -> str:
        name = match.group(1)
        operator = match.group("op")
        word = match.group("word") or ""
        colon = match.group("colon") is not None
        present, value = lookup(name)
        if operator is None:
            if not present:
                raise ValueError(f"정의되지 않은 변수 ${{{name}}}")
            return value
        if operator == "-":
            if colon:
                return word if (not present or value == "") else value
            return word if not present else value
        if operator == "+":
            if colon:
                return word if present and value != "" else ""
            return word if present else ""
        if operator == "?":
            missing = (not present) or (colon and value == "")
            if missing:
                detail = f" ({word})" if word else ""
                raise ValueError(f"필수 빌드 인자 {name}가 없습니다{detail}")
            return value
        raise ValueError(f"지원하지 않는 치환입니다: {match.group(0)}")

    def repl_simple(match: re.Match[str]) -> str:
        name = match.group(1)
        present, value = lookup(name)
        if not present:
            raise ValueError(f"정의되지 않은 변수 ${name}")
        return value

    current = text
    for _ in range(10):
        updated = BRACED_VAR.sub(repl_braced, current)
        updated = SIMPLE_VAR.sub(repl_simple, updated)
        if updated == current:
            return current
        current = updated
    raise ValueError(f"이미지 참조 치환이 끝나지 않습니다: {text}")


def strip_trailing_comment(text: str) -> str:
    quote = None
    escaped = False
    for index, char in enumerate(text):
        if quote:
            if escaped:
                escaped = False
                continue
            if char == "\\" and quote == '"':
                escaped = True
                continue
            if char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
            continue
        if char == "#" and (index == 0 or text[index - 1].isspace()):
            return text[:index].rstrip()
    return text.rstrip()


def unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def strip_from_flags(rest: str) -> str:
    rest = rest.strip()
    while rest.startswith("--"):
        match = FROM_FLAGS.match(rest)
        if not match:
            break
        rest = rest[match.end() :].strip()
    return rest


def logical_lines(text: str) -> list[tuple[int, str]]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    output: list[tuple[int, str]] = []
    buffer: list[str] = []
    start: int | None = None
    for index, line in enumerate(lines, 1):
        if start is None:
            start = index
        if line.endswith("\\"):
            buffer.append(line[:-1])
            continue
        buffer.append(line)
        output.append((start, "".join(buffer).strip()))
        buffer = []
        start = None
    if buffer and start is not None:
        output.append((start, "".join(buffer).strip()))
    return output


def parse_dockerfile(text: str, path: str) -> tuple[list[ImageUse], list[str]]:
    images: list[ImageUse] = []
    errors: list[str] = []
    global_args: dict[str, str] = {}
    seen_from = False
    stages: set[str] = set()

    for line_no, line in logical_lines(text):
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z]+)\s*(.*)$", line)
        if not match:
            continue
        instruction = match.group(1).upper()
        rest = match.group(2).strip()
        if instruction == "ARG" and not seen_from:
            arg_match = ARG_RE.match(strip_trailing_comment(rest))
            if not arg_match:
                errors.append(f"{path}:{line_no}: ARG 구문을 해석하지 못했습니다: {rest}")
                continue
            name = arg_match.group(1)
            raw_value = arg_match.group(2)
            if raw_value is None:
                global_args.setdefault(name, "")
            else:
                try:
                    global_args[name] = substitute(unquote(raw_value.strip()), global_args)
                except ValueError as exc:
                    errors.append(f"{path}:{line_no}: {exc}")
            continue
        if instruction != "FROM":
            continue
        seen_from = True
        rest = strip_trailing_comment(strip_from_flags(rest))
        stage = None
        stage_match = STAGE_RE.search(rest)
        if stage_match:
            stage = stage_match.group(1)
            rest = rest[: stage_match.start()].strip()
        try:
            resolved = substitute(rest, global_args)
        except ValueError as exc:
            errors.append(f"{path}:{line_no}: {exc}")
            if stage:
                stages.add(stage)
            continue
        if re.search(r"\$(\{|[A-Za-z_])", resolved):
            errors.append(f"{path}:{line_no}: FROM 변수를 해석하지 못했습니다: {rest}")
            if stage:
                stages.add(stage)
            continue
        name, tag, digest = split_ref(resolved)
        if not name:
            errors.append(f"{path}:{line_no}: 이미지 이름이 비어 있습니다")
            continue
        if tag is None and digest is None and (name in stages or name.isdigit()):
            if stage:
                stages.add(stage)
            continue
        if stage:
            stages.add(stage)
        images.append(
            ImageUse(
                name=name,
                tag=tag,
                digest=digest,
                path=path,
                line=line_no,
                stage=stage,
                service="",
            )
        )
    return images, errors


def indent_of(raw: str, path: str, line_no: int) -> int:
    stripped = raw.lstrip(" ")
    if raw.startswith("\t") or (stripped != raw.lstrip() and "\t" in raw[: len(raw) - len(raw.lstrip())]):
        raise ParseError(f"{path}:{line_no}: 탭 들여쓰기는 지원하지 않습니다")
    return len(raw) - len(stripped)


def strip_inline_comment(value: str) -> str:
    return strip_trailing_comment(value).strip()


class ComposeParser:
    def __init__(self, text: str, path: str) -> None:
        self.path = path
        self.lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        self.stack: list[tuple[int, str]] = []
        self.services: dict[str, ComposeService] = {}
        self.flow_depth = 0
        self.flow_quote: str | None = None
        self.block_indent: int | None = None

    def parse(self) -> list[ComposeService]:
        index = 0
        total = len(self.lines)
        while index < total:
            raw = self.lines[index]
            line_no = index + 1
            if self.flow_depth:
                self._feed_flow(raw, line_no)
                index += 1
                continue
            if self.block_indent is not None:
                if raw.strip() == "" or indent_of(raw, self.path, line_no) > self.block_indent:
                    index += 1
                    continue
                self.block_indent = None
            if raw.strip() == "" or raw.lstrip().startswith("#"):
                index += 1
                continue
            if raw.strip() == "---":
                self.stack.clear()
                index += 1
                continue
            stripped = raw.strip()
            indent = indent_of(raw, self.path, line_no)
            if stripped.startswith("[") or stripped.startswith("{"):
                if not self.stack:
                    raise ParseError(f"{self.path}:{line_no}: 흐름 컬렉션의 부모 키가 없습니다")
                self._feed_flow(stripped, line_no)
                self.stack.pop()
                index += 1
                continue
            if stripped.startswith("-"):
                parent = self.stack[-1][1] if self.stack else ""
                if parent == "services":
                    raise ParseError(f"{self.path}:{line_no}: services는 매핑이어야 합니다")
                index += 1
                continue
            match = KEY_VALUE.match(stripped)
            if not match:
                raise ParseError(f"{self.path}:{line_no}: 지원하지 않는 Compose 구문입니다: {stripped}")
            key = match.group(1)
            raw_value = strip_inline_comment(match.group(2).strip())
            value = unquote(raw_value)
            is_block = BLOCK_SCALAR.fullmatch(value) is not None
            while self.stack and self.stack[-1][0] >= indent:
                self.stack.pop()
            path_keys = [item for _, item in self.stack] + [key]
            self._handle(path_keys, value, is_block, line_no)
            if is_block:
                self.block_indent = indent
            elif value == "":
                self.stack.append((indent, key))
            elif value.startswith("[") or value.startswith("{"):
                self._feed_flow(value, line_no)
            index += 1
        if self.flow_depth:
            raise ParseError(f"{self.path}: 흐름 컬렉션이 닫히지 않았습니다")
        return list(self.services.values())

    def _feed_flow(self, text: str, line_no: int) -> None:
        index = 0
        while index < len(text):
            char = text[index]
            if self.flow_quote:
                if char == "\\" and self.flow_quote == '"':
                    index += 2
                    continue
                if char == self.flow_quote:
                    self.flow_quote = None
                index += 1
                continue
            if char in "\"'":
                self.flow_quote = char
                index += 1
                continue
            if char in "[{":
                self.flow_depth += 1
            elif char in "]}":
                self.flow_depth -= 1
                if self.flow_depth < 0:
                    raise ParseError(f"{self.path}:{line_no}: 대괄호가 맞지 않습니다")
            index += 1

    def _service(self, name: str) -> ComposeService:
        service = self.services.get(name)
        if service is None:
            service = ComposeService(name=name)
            self.services[name] = service
        return service

    def _handle(self, path_keys: list[str], value: str, is_block: bool, line_no: int) -> None:
        if path_keys[0] == "include":
            raise ParseError(
                f"{self.path}:{line_no}: include는 지원하지 않습니다. 이미지를 이 파일에 적거나 파서를 확장하세요."
            )
        if path_keys == ["services"] or path_keys[0] != "services":
            return
        if len(path_keys) == 2 and value == "" and not is_block:
            if path_keys[1] in self.services:
                raise ParseError(f"{self.path}:{line_no}: 서비스 {path_keys[1]}가 중복입니다")
            self.services[path_keys[1]] = ComposeService(name=path_keys[1])
            return
        if len(path_keys) == 3 and path_keys[2] == "extends":
            raise ParseError(
                f"{self.path}:{line_no}: extends는 지원하지 않습니다. 서비스 이미지를 이 파일에 직접 적으세요."
            )
        if len(path_keys) == 3 and path_keys[2] == "image":
            if is_block or not value:
                raise ParseError(f"{self.path}:{line_no}: image 값을 해석하지 못했습니다")
            service = self._service(path_keys[1])
            service.image = value
            service.image_line = line_no
            return
        if len(path_keys) == 3 and path_keys[2] == "build":
            if is_block:
                raise ParseError(f"{self.path}:{line_no}: build 블록 스칼라는 지원하지 않습니다")
            service = self._service(path_keys[1])
            service.has_build = True
            service.build_line = line_no
            if value:
                service.context = value
            return
        if len(path_keys) == 4 and path_keys[2] == "build" and path_keys[3] in {"context", "dockerfile"}:
            if is_block or not value:
                raise ParseError(f"{self.path}:{line_no}: build.{path_keys[3]} 값을 해석하지 못했습니다")
            service = self._service(path_keys[1])
            service.has_build = True
            if path_keys[3] == "context":
                service.context = value
            else:
                service.dockerfile = value


def parse_compose(text: str, path: str) -> list[ComposeService]:
    return ComposeParser(text, path).parse()


def is_dockerfile(name: str) -> bool:
    return name == "Dockerfile" or name.startswith("Dockerfile.")


def is_compose(name: str) -> bool:
    suffix = name.rsplit(".", 1)[-1]
    if suffix not in {"yml", "yaml"}:
        return False
    return name.startswith("docker-compose") or name == "compose.yml" or name == "compose.yaml" or name.startswith("compose.")


def discover(root: Path) -> tuple[list[Path], list[Path]]:
    dockerfiles: list[Path] = []
    compose_files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(name for name in dirnames if name not in SKIP_DIRS)
        for name in sorted(filenames):
            path = Path(dirpath) / name
            if is_dockerfile(name):
                dockerfiles.append(path)
            elif is_compose(name):
                compose_files.append(path)
    return dockerfiles, compose_files


def repo_relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def resolve_build_file(compose_path: Path, service: ComposeService, root: Path) -> str | None:
    if not service.has_build:
        return None
    context = service.context or "."
    dockerfile = service.dockerfile or "Dockerfile"
    candidate = (compose_path.parent / context / dockerfile).resolve()
    try:
        return candidate.relative_to(root.resolve()).as_posix()
    except ValueError:
        return candidate.as_posix()


def format_services(pairs: list[tuple[str, str]]) -> str:
    if not pairs:
        return "—"
    unique: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for pair in pairs:
        if pair not in seen:
            seen.add(pair)
            unique.append(pair)
    files = {path for _, path in unique}
    if len(files) == 1:
        return ", ".join(f"`{name}`" for name, _ in unique)
    return ", ".join(f"`{name}` ({path})" for name, path in unique)


def pin_problems(image: ImageUse) -> list[str]:
    problems: list[str] = []
    if image.digest and not DIGEST_RE.fullmatch(image.digest):
        problems.append(
            f"{image.path}:{image.line}: 다이제스트 형식이 아닙니다: {image.digest}. sha256: 와 64자리 hex만 허용합니다."
        )
    if not is_pinned(image.name, image.tag, image.digest):
        shown = display_ref(image.name, image.tag, image.digest)
        problems.append(
            f"{image.path}:{image.line}: 이미지 {shown} 가 정확한 버전으로 고정되지 않았습니다. "
            "태그를 MAJOR.MINOR.PATCH(예: 1.30.7-alpine, 22.23.5-alpine)로 적거나 sha256 다이제스트로 고정한 뒤 "
            "`python3 scripts/generate-docker-versions.py` 를 실행하세요."
        )
    return problems


def collect(root: Path) -> Inventory:
    inventory = Inventory()
    dockerfiles, compose_files = discover(root)
    services_by_dockerfile: dict[str, list[tuple[str, str]]] = {}

    for compose_path in compose_files:
        relative = repo_relative(compose_path, root)
        try:
            services = parse_compose(compose_path.read_text(encoding="utf-8"), relative)
        except ParseError as exc:
            inventory.errors.append(str(exc))
            continue
        for service in services:
            dockerfile = resolve_build_file(compose_path, service, root)
            if dockerfile and not dockerfile.startswith("/"):
                services_by_dockerfile.setdefault(dockerfile, []).append((service.name, relative))
            if service.image:
                name, tag, digest = split_ref(service.image)
                inventory.images.append(
                    ImageUse(
                        name=name,
                        tag=tag,
                        digest=digest,
                        path=relative,
                        line=service.image_line or 1,
                        stage=None,
                        service=format_services([(service.name, relative)]),
                    )
                )

    for dockerfile in dockerfiles:
        relative = repo_relative(dockerfile, root)
        images, errors = parse_dockerfile(dockerfile.read_text(encoding="utf-8"), relative)
        inventory.errors.extend(errors)
        service_label = format_services(services_by_dockerfile.get(relative, []))
        for image in images:
            image.service = service_label
            inventory.images.append(image)

    inventory.images.sort(key=lambda image: (image.path, image.line, image.stage or "", image.name))
    for image in inventory.images:
        inventory.errors.extend(pin_problems(image))
    return inventory


def code_cell(value: str | None) -> str:
    if not value:
        return "—"
    escaped = value.replace("`", "'")
    return f"`{escaped}`"


def location_cell(path: str, line: int) -> str:
    escaped = path.replace("`", "'")
    return f"[`{escaped}`](../{escaped}#L{line})"


def render(inventory: Inventory) -> str:
    lines = [
        "# Docker 이미지 버전",
        "",
        "이 파일은 [`scripts/generate-docker-versions.py`](../scripts/generate-docker-versions.py)가 생성합니다. 손으로 고치지 않습니다.",
        "",
        "Dockerfile의 `FROM`과 Compose 파일의 `image`에 적힌 베이스·서비스 이미지를 한 줄씩 기록합니다. 태그는 `MAJOR.MINOR.PATCH`로 고정합니다. `-alpine` 같은 변형은 태그의 일부입니다. `@sha256:…` 다이제스트는 선택입니다. 서비스 열은 그 Dockerfile을 `build`하는 Compose 서비스이거나, `image`를 선언한 서비스입니다. 단계 열은 Dockerfile의 `AS` 이름이고, 이름이 없으면 —입니다.",
        "",
        "풀 리퀘스트가 Dockerfile, Compose 파일, 이 문서, 생성 스크립트를 바꾸면 [`.github/workflows/docker-versions.yml`](../.github/workflows/docker-versions.yml)이 문서를 다시 씁니다. 같은 저장소 브랜치(Dependabot 브랜치 포함)에는 그 결과를 커밋합니다. 포크이거나 푸시가 거절되면 검사를 실패시키고, 아래 명령을 실행하라는 메시지를 남깁니다.",
        "",
        "```bash",
        "python3 scripts/generate-docker-versions.py",
        "```",
        "",
        "스캔 범위는 저장소의 `Dockerfile`, `Dockerfile.*`, `docker-compose*.yml`, `docker-compose*.yaml`, `compose.yml`, `compose.yaml`, `compose.*.yml`, `compose.*.yaml`입니다. `.git`, `node_modules`, `.yarn`, `dist`, `coverage`, `.next`는 제외합니다.",
        "",
        "| 서비스 | 이미지 | 태그 | 다이제스트 | 정의 위치 | 단계 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    if not inventory.images:
        lines.append("| — | — | — | — | — | — |")
    for image in inventory.images:
        tag = "—" if image.name == "scratch" and not image.tag else (image.tag or ("—" if image.digest else "latest"))
        lines.append(
            "| {service} | {image} | {tag} | {digest} | {where} | {stage} |".format(
                service=image.service or "—",
                image=code_cell(image.name),
                tag=code_cell(None if tag == "—" else tag),
                digest=code_cell(image.digest),
                where=location_cell(image.path, image.line),
                stage=code_cell(image.stage),
            )
        )
    lines.append("")
    return "\n".join(lines)


def default_root() -> Path:
    return Path(__file__).resolve().parent.parent


def write_document(root: Path, markdown: str) -> Path:
    destination = root / "docs" / "docker-versions.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(markdown, encoding="utf-8", newline="\n")
    return destination


def run(root: Path, check: bool) -> int:
    inventory = collect(root)
    markdown = render(inventory)
    destination = root / "docs" / "docker-versions.md"
    if check:
        existing = destination.read_text(encoding="utf-8") if destination.exists() else ""
        if existing != markdown:
            inventory.errors.append(
                "docs/docker-versions.md가 생성 결과와 다릅니다. python3 scripts/generate-docker-versions.py 를 실행하고 커밋하세요."
            )
    else:
        write_document(root, markdown)
        print(f"wrote {destination.relative_to(root).as_posix()}")
    if inventory.errors:
        for error in inventory.errors:
            print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


def build_fixture(root: Path) -> None:
    (root / "client").mkdir()
    (root / "server").mkdir()
    (root / "nginx").mkdir()
    (root / "client" / "Dockerfile").write_text("FROM node:22.23.5-alpine\n", encoding="utf-8")
    (root / "server" / "Dockerfile").write_text(
        "FROM node:22.23.5-alpine AS builder\nRUN echo build\nFROM node:22.23.5-alpine\n",
        encoding="utf-8",
    )
    (root / "nginx" / "Dockerfile").write_text("FROM nginx:1.30.7-alpine\n", encoding="utf-8")
    (root / "docker-compose.yml").write_text(
        """
networks:
  webapp:
    name: webapp

services:
  server:
    build:
      context: .
      dockerfile: server/Dockerfile
    command:
      - yarn
    environment:
      - NODE_ENV=development
    healthcheck:
      test:
        [
          'CMD-SHELL',
          'wget -q --spider http://server:3000/api/health || exit 1',
        ]
      interval: 7s
    networks:
      - webapp
  client:
    build:
      context: .
      dockerfile: client/Dockerfile
  nginx:
    build:
      context: .
      dockerfile: nginx/Dockerfile
  db:
    image: "mysql:9.7.4"
  cache:
    image: redis:8.2.11@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
""".lstrip(),
        encoding="utf-8",
    )


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def self_test() -> None:
    expect(is_exact_tag("1.30.7-alpine"), "nginx tag")
    expect(is_exact_tag("22.23.5-alpine"), "node tag")
    expect(is_exact_tag("9.7.4"), "mysql tag")
    expect(is_exact_tag("1.30.7-alpine3.24"), "alpine patch suffix")
    expect(not is_exact_tag("alpine"), "floating alpine")
    expect(not is_exact_tag("latest"), "floating latest")
    expect(not is_exact_tag("1.30"), "floating minor")
    expect(not is_exact_tag("1.30-alpine"), "floating patch")
    expect(not is_exact_tag("22-alpine"), "floating node major")
    expect(not is_exact_tag(None), "missing tag")

    name, tag, digest = split_ref("localhost:5000/app:1.2.3")
    expect((name, tag, digest) == ("localhost:5000/app", "1.2.3", None), "registry port")
    name, tag, digest = split_ref("nginx@sha256:" + "a" * 64)
    expect(name == "nginx" and tag is None and digest == "sha256:" + "a" * 64, "digest only")

    images, errors = parse_dockerfile(
        "ARG NODE_VERSION=22.23.5\nFROM node:${NODE_VERSION}-alpine AS builder\n"
        "FROM node:${NODE_VERSION}-alpine\nFROM builder\nFROM scratch\n",
        "server/Dockerfile",
    )
    expect(errors == [], f"arg dockerfile errors: {errors}")
    expect(len(images) == 3, f"expected 3 images, got {images}")
    expect(images[0].stage == "builder" and images[0].tag == "22.23.5-alpine", "builder stage")
    expect(images[2].name == "scratch" and is_pinned("scratch", None, None), "scratch")

    images, errors = parse_dockerfile(
        "FROM node:22.23.5-alpine AS builder\nARG VER=1.2.3\nFROM node:${VER}\n",
        "server/Dockerfile",
    )
    expect(any("정의되지 않은 변수" in error for error in errors), f"stage arg must not leak: {errors}")

    images, errors = parse_dockerfile(
        "FROM --platform=linux/arm64 nginx:1.30.7-alpine # pinned\n",
        "nginx/Dockerfile",
    )
    expect(errors == [] and images[0].tag == "1.30.7-alpine", f"platform flag: {images} {errors}")

    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        build_fixture(root)
        inventory = collect(root)
        expect(inventory.errors == [], f"fixture errors: {inventory.errors}")
        refs = [(image.service, image.name, image.tag, image.path, image.line, image.stage) for image in inventory.images]
        expect(
            ("`client`", "node", "22.23.5-alpine", "client/Dockerfile", 1, None) in refs,
            f"client row missing: {refs}",
        )
        expect(
            ("`nginx`", "nginx", "1.30.7-alpine", "nginx/Dockerfile", 1, None) in refs,
            f"nginx row missing: {refs}",
        )
        expect(
            ("`server`", "node", "22.23.5-alpine", "server/Dockerfile", 1, "builder") in refs,
            f"server builder missing: {refs}",
        )
        expect(
            ("`server`", "node", "22.23.5-alpine", "server/Dockerfile", 3, None) in refs,
            f"server runtime missing: {refs}",
        )
        expect(any(image.name == "mysql" and image.tag == "9.7.4" for image in inventory.images), "mysql image")
        expect(any(image.name == "redis" and image.digest and image.digest.startswith("sha256:") for image in inventory.images), "redis digest")
        first = render(inventory)
        second = render(collect(root))
        expect(first == second and first.endswith("\n"), "render is not stable")

        (root / "nginx" / "Dockerfile").write_text("FROM nginx:alpine\n", encoding="utf-8")
        floated = collect(root)
        expect(any("nginx:alpine" in error for error in floated.errors), f"floating tag not rejected: {floated.errors}")

        (root / "edge").mkdir()
        (root / "edge" / "Dockerfile").write_text("FROM nginx:1.30.7-alpine\n", encoding="utf-8")
        (root / "docker-compose.prod.yml").write_text(
            "services:\n  edge:\n    build: ./edge\n    image: ghcr.io/example/edge:1.2.3 # published\n",
            encoding="utf-8",
        )
        extra = collect(root)
        expect(
            any(image.path == "edge/Dockerfile" and image.service == "`edge`" and image.tag == "1.30.7-alpine" for image in extra.images),
            f"string build form was not linked: {extra.images}",
        )
        expect(
            any(image.name == "ghcr.io/example/edge" and image.tag == "1.2.3" and image.path == "docker-compose.prod.yml" for image in extra.images),
            f"inline comment image was not parsed: {extra.images}",
        )

    images, errors = parse_dockerfile("ARG VER\nFROM node:${VER:-22.23.5}-alpine\n", "Dockerfile")
    expect(errors == [] and images[0].tag == "22.23.5-alpine", f"default arg: {images} {errors}")

    try:
        parse_compose("include:\n  - other.yml\n", "docker-compose.yml")
    except ParseError as exc:
        expect("include" in str(exc), str(exc))
    else:
        raise AssertionError("include should fail")

    print("self-test ok")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate docs/docker-versions.md")
    parser.add_argument("--check", action="store_true", help="exit 1 if the document would change or a tag is not pinned")
    parser.add_argument("--self-test", action="store_true", help="run parser tests")
    parser.add_argument("--root", type=Path, default=None, help="repository root (defaults to the parent of scripts/)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.self_test:
        self_test()
        return 0
    root = (args.root or default_root()).resolve()
    return run(root, check=args.check)


if __name__ == "__main__":
    sys.exit(main())
