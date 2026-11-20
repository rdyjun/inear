#!/bin/sh
# blue/green 배포. server-blue 가 돌고 있으면 green 으로, 아니면 blue 로 올린다.
# 새 컨테이너가 healthy 가 된 뒤에만 nginx upstream 을 바꾸고 이전 컨테이너를 지운다.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$ROOT"

COMPOSE_FILE="$ROOT/deploy/docker-compose.yml"
ENV_FILE="$ROOT/.env"
NGINX_CONF="$ROOT/nginx/conf.d/default.conf"

compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

container_running() {
  docker ps --filter "name=^$1$" --filter "status=running" -q | grep -q .
}

wait_healthy() {
  container="$1"
  i=0
  status="missing"
  while [ "$i" -lt 120 ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"
    if [ "$status" = "healthy" ]; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "$container did not become healthy within 120s (last status: $status)" >&2
  return 1
}

switch_upstream() {
  from="$1"
  to="$2"
  if [ ! -f "$NGINX_CONF" ]; then
    echo "missing $NGINX_CONF" >&2
    return 1
  fi
  tmp="$(mktemp)"
  sed "s/${from}:3000/${to}:3000/g" "$NGINX_CONF" > "$tmp"
  mv "$tmp" "$NGINX_CONF"
  docker exec nginx nginx -s reload
}

stop_container() {
  name="$1"
  if ! docker ps -a --filter "name=^${name}$" -q | grep -q .; then
    return 0
  fi
  compose stop "$name" || docker stop "$name"
  compose rm -f "$name" || docker rm -f "$name"
}

if container_running server-blue; then
  compose up -d server-green
  wait_healthy server-green
  switch_upstream server-blue server-green
  stop_container server-blue
else
  compose up -d server-blue
  wait_healthy server-blue
  switch_upstream server-green server-blue
  stop_container server-green
fi
