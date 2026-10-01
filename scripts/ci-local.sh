#!/usr/bin/env bash
#
# Run every check in .github/workflows/ci.yml on this machine.
#
#   scripts/ci-local.sh
#
# For when GitHub Actions is unavailable. Takes ~20 minutes, mostly the API
# suite against PostgreSQL. Needs Docker, the PostgreSQL client tools, and the
# local environments the READMEs set up (backend/*/.venv, frontend/node_modules).
# PostgreSQL and Redis run in throwaway containers on PG_PORT / REDIS_PORT
# (default 55432 / 56379, clear of anything already on 5432 / 6379).
#
# Keep in step with ci.yml: a check added there and not here is a check that
# silently stops running while CI is down.

set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PG_PORT=${PG_PORT:-55432}
REDIS_PORT=${REDIS_PORT:-56379}
PG=postgresql+psycopg://aegis:aegis@localhost:$PG_PORT/aegis_test
LOGS=$(mktemp -d)
API=$ROOT/backend/api_server
VISION=$ROOT/backend/vision_service
FE=$ROOT/frontend
failed=()

step() {
  local name=$1; shift
  printf '%-28s' "$name"
  if ( "$@" ) >"$LOGS/$name.log" 2>&1; then echo pass; else echo "FAIL  (log: $LOGS/$name.log)"; failed+=("$name"); fi
}

cleanup() {
  docker rm -f aegis-ci-pg aegis-ci-redis aegis-ci-fe >/dev/null 2>&1
  docker rmi -f aegis-ci-api aegis-ci-vision aegis-ci-frontend >/dev/null 2>&1
  rm -f "$ROOT/monitoring/.ci-prometheus.yml" "$ROOT/monitoring/.ci-metrics-token"
}
trap cleanup EXIT

docker rm -f aegis-ci-pg aegis-ci-redis >/dev/null 2>&1
docker run -d --name aegis-ci-pg -e POSTGRES_USER=aegis -e POSTGRES_PASSWORD=aegis \
  -e POSTGRES_DB=aegis_test -p "$PG_PORT:5432" postgres:16-alpine >/dev/null
docker run -d --name aegis-ci-redis -p "$REDIS_PORT:6379" redis:7-alpine >/dev/null
for _ in $(seq 30); do docker exec aegis-ci-pg pg_isready -U aegis -d aegis_test >/dev/null 2>&1 && break; sleep 1; done

# --- API server
step api-tests-sqlite bash -c "cd $API && .venv/bin/python -m pytest -q"
step api-tests-postgres bash -c "cd $API && TEST_DATABASE_URL=$PG REDIS_URL=redis://localhost:$REDIS_PORT/1 \
  TEST_REDIS_URL=redis://localhost:$REDIS_PORT/0 .venv/bin/python -m pytest -q"
step backup-restores bash -c "cd $API && export PATH=$API/.venv/bin:\$PATH PGPASSWORD=aegis DATABASE_URL=$PG \
  SECRET_KEY=ci-only-not-a-real-secret && alembic upgrade head \
  && AEGIS_PASSWORD=ci-only-password-long python -m app.cli create-user --email ci@aegis.example --name CI --role admin \
  && ../../scripts/backup.sh $LOGS/backups \
  && VERIFY_ADMIN_URL=postgresql://aegis:aegis@localhost:$PG_PORT/postgres ../../scripts/verify-backup.sh $LOGS/backups/*.dump"
step migrations bash -c "cd $API && export PATH=$API/.venv/bin:\$PATH DATABASE_URL=$PG SECRET_KEY=ci-only-not-a-real-secret \
  && alembic upgrade head && alembic check && alembic downgrade base && alembic upgrade head"

# --- Observability: run the log-contract script embedded in ci.yml itself.
step log-contract bash -c "cd $API && sed -n '/python - <<.PY./,/^          PY\$/p' $ROOT/.github/workflows/ci.yml \
  | sed '1d;\$d; s/^          //' | SECRET_KEY=ci-only-not-a-real-secret DATABASE_URL='sqlite+pysqlite:///:memory:' .venv/bin/python -"

# --- Monitoring config
cd "$ROOT"
step prometheus-rules docker run --rm -v "$ROOT/monitoring:/cfg:ro" --entrypoint promtool \
  prom/prometheus:v3.1.0 check rules /cfg/alerts.yml
step prometheus-config bash -c "sed 's|\\\\development|ci|; s|/etc/prometheus/alerts.yml|/cfg/alerts.yml|; \
  s|/etc/prometheus/metrics-token|/cfg/.ci-metrics-token|' monitoring/prometheus.yml > monitoring/.ci-prometheus.yml \
  && echo ci-token > monitoring/.ci-metrics-token \
  && docker run --rm -v $ROOT/monitoring:/cfg:ro --entrypoint promtool prom/prometheus:v3.1.0 check config /cfg/.ci-prometheus.yml"
step alertmanager docker run --rm -v "$ROOT/monitoring:/cfg:ro" --entrypoint amtool \
  prom/alertmanager:v0.28.0 check-config /cfg/alertmanager.yml
step compose-defaults bash -c "export POSTGRES_PASSWORD=x SECRET_KEY=x VISION_SERVICE_PASSWORD=x METRICS_TOKEN=x; \
  c=\$(docker compose --env-file /dev/null --profile vision config) \
  && grep -q 'ENVIRONMENT: production' <<<\"\$c\" && grep -q 'VISION_ENVIRONMENT: production' <<<\"\$c\" \
  && grep -q 'VISION_DETECTOR: onnx' <<<\"\$c\""
step grafana-dashboards python3 -c "import json,glob; [json.load(open(f)) for f in glob.glob('monitoring/grafana/dashboards/*.json')]"

# --- Vision service
step vision-tests bash -c "cd $VISION && .venv/bin/python -m pytest -q"

# --- Frontend
step frontend-install bash -c "cd $FE && npm ci"
step frontend-lint bash -c "cd $FE && npm run lint"
step frontend-typecheck bash -c "cd $FE && npm run typecheck"
step frontend-tests bash -c "cd $FE && npm test"
step frontend-build bash -c "cd $FE && npm run build"
step npm-audit bash -c "cd $FE && npm audit --audit-level=high"

# --- Container images
for spec in api:backend/api_server vision:backend/vision_service frontend:frontend; do
  name=${spec%%:*}; ctx=${spec#*:}
  step "image-$name" bash -c "docker build -q -t aegis-ci-$name $ctx \
    && test \"\$(docker run --rm --entrypoint sh aegis-ci-$name -c 'id -u')\" != 0"
done
step frontend-headers bash -c "docker run -d --name aegis-ci-fe -p 18080:8080 \
  -e API_URL=https://api.example.test/api/v1 aegis-ci-frontend >/dev/null \
  && for _ in \$(seq 20); do curl -fs http://localhost:18080/healthz >/dev/null && break; sleep 1; done \
  && h=\$(curl -sI http://localhost:18080/guard) && echo \"\$h\" \
  && grep -qi '^x-frame-options: DENY' <<<\"\$h\" && grep -qi '^x-content-type-options: nosniff' <<<\"\$h\" \
  && grep -qi \"^content-security-policy: .*script-src 'self'\" <<<\"\$h\" \
  && grep -qi '^content-security-policy: .*https://api.example.test' <<<\"\$h\""

echo
if ((${#failed[@]})); then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "All checks passed."
