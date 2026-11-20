# Docker 이미지 버전

이 파일은 [`scripts/generate-docker-versions.py`](../scripts/generate-docker-versions.py)가 생성합니다. 손으로 고치지 않습니다.

Dockerfile의 `FROM`과 Compose 파일의 `image`에 적힌 베이스·서비스 이미지를 한 줄씩 기록합니다. 태그는 `MAJOR.MINOR.PATCH`로 고정합니다. `-alpine` 같은 변형은 태그의 일부입니다. `@sha256:…` 다이제스트는 선택입니다. 서비스 열은 그 Dockerfile을 `build`하는 Compose 서비스이거나, `image`를 선언한 서비스입니다. 단계 열은 Dockerfile의 `AS` 이름이고, 이름이 없으면 —입니다.

풀 리퀘스트가 Dockerfile, Compose 파일, 이 문서, 생성 스크립트를 바꾸면 [`.github/workflows/docker-versions.yml`](../.github/workflows/docker-versions.yml)이 문서를 다시 씁니다. 같은 저장소 브랜치(Dependabot 브랜치 포함)에는 그 결과를 커밋합니다. 포크이거나 푸시가 거절되면 검사를 실패시키고, 아래 명령을 실행하라는 메시지를 남깁니다.

```bash
python3 scripts/generate-docker-versions.py
```

스캔 범위는 저장소의 `Dockerfile`, `Dockerfile.*`, `docker-compose*.yml`, `docker-compose*.yaml`, `compose.yml`, `compose.yaml`, `compose.*.yml`, `compose.*.yaml`입니다. `.git`, `node_modules`, `.yarn`, `dist`, `coverage`, `.next`는 제외합니다.

| 서비스 | 이미지 | 태그 | 다이제스트 | 정의 위치 | 단계 |
| --- | --- | --- | --- | --- | --- |
| `client` | `node` | `22.23.5-alpine` | — | [`client/Dockerfile`](../client/Dockerfile#L1) | — |
| `nginx` | `nginx` | `1.30.7-alpine` | — | [`nginx/Dockerfile`](../nginx/Dockerfile#L1) | — |
| `server` | `node` | `22.23.5-alpine` | — | [`server/Dockerfile`](../server/Dockerfile#L1) | `builder` |
| `server` | `node` | `22.23.5-alpine` | — | [`server/Dockerfile`](../server/Dockerfile#L16) | — |
