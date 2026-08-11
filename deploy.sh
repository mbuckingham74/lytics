#!/usr/bin/env bash

set -Eeuo pipefail

PHASE="initialization"

on_error() {
  local exit_code=$?
  printf 'ERROR [%s]: deployment aborted (line %s, exit %s).\n' \
    "$PHASE" "${BASH_LINENO[0]}" "$exit_code" >&2
  exit "$exit_code"
}

trap on_error ERR

fail() {
  printf 'ERROR [%s]: %s\n' "$PHASE" "$*" >&2
  exit 1
}

require_local_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "required local tool not found: $1"
}

PHASE="local configuration"

readonly DEPLOY_PATH='/home/michael/docker-configs/lytics'
readonly DEPLOY_HOST='michael@100.120.233.4'
readonly STAGE_DIRECTORY_NAME='.lytics-deploy-source'
readonly STAGE_MARKER_NAME='.lytics-deploy-source-owned-by-deploy-sh'
readonly STAGE_MARKER_CONTENT='lytics-deploy-source:v1'

for tool in git ssh rsync; do
  require_local_tool "$tool"
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$SCRIPT_DIR"

[[ "$(git rev-parse --show-toplevel 2>/dev/null)" == "$SCRIPT_DIR" ]] || \
  fail 'deploy.sh must be located and run from the Git repository root.'

PHASE="local Git validation"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  fail 'the local Git worktree is not clean; commit or remove all changes first.'
fi

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)" || \
  fail 'the current branch has no upstream; push it with upstream tracking first.'

read -r BEHIND AHEAD < <(git rev-list --left-right --count "$UPSTREAM"...HEAD)
[[ "$AHEAD" == "0" ]] || \
  fail "the local branch has $AHEAD unpushed commit(s); push before deploying."
[[ "$BEHIND" == "0" ]] || \
  fail "the local branch is $BEHIND commit(s) behind $UPSTREAM; update it before deploying."

SSH_OPTIONS=(-o BatchMode=yes -o ConnectTimeout=10)
RSYNC_SHELL='ssh -o BatchMode=yes -o ConnectTimeout=10'

PHASE="SSH validation"

ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" true || \
  fail "cannot establish non-interactive SSH access to $DEPLOY_HOST."

PHASE="remote preflight"

EXISTING_DATA_VOLUME="$(ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" bash -s -- \
  "$DEPLOY_PATH" "$STAGE_DIRECTORY_NAME" "$STAGE_MARKER_NAME" \
  "$STAGE_MARKER_CONTENT" <<'REMOTE_PREFLIGHT'
set -Eeuo pipefail

deploy_path=$1
stage_directory_name=$2
stage_marker_name=$3
stage_marker_content=$4
stage_path="$deploy_path/$stage_directory_name"
stage_marker_path="$stage_path/$stage_marker_name"
compose=(docker compose --env-file .env)

remote_fail() {
  printf 'ERROR [remote preflight]: %s\n' "$*" >&2
  exit 1
}

running_service_container() {
  local container_count container_ids container_state

  container_ids="$("${compose[@]}" ps -a -q lytics)" || \
    remote_fail 'could not resolve the existing lytics service container.'
  container_count="$(printf '%s\n' "$container_ids" | awk 'NF { count++ } END { print count + 0 }')"
  [[ "$container_count" == "1" ]] || \
    remote_fail "expected exactly one existing lytics service container; found $container_count."
  container_state="$(docker inspect --format '{{.State.Running}}' "$container_ids")" || \
    remote_fail 'could not inspect the existing lytics service container.'
  [[ "$container_state" == "true" ]] || \
    remote_fail 'the existing lytics service container is not running.'
  printf '%s\n' "$container_ids"
}

named_data_volume() {
  local container_id=$1
  local container_project logical_volume mount_count mount_rows
  local mount_rw mount_source mount_type volume_mountpoint volume_name volume_project

  mount_rows="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{printf "%s\t%s\t%s\t%t\n" .Type .Name .Source .RW}}{{end}}{{end}}' "$container_id")" || \
    remote_fail 'could not inspect /data mounts on the existing lytics container.'
  mount_count="$(printf '%s\n' "$mount_rows" | awk 'NF { count++ } END { print count + 0 }')"
  [[ "$mount_count" == "1" ]] || \
    remote_fail "expected exactly one /data mount on the existing lytics container; found $mount_count."
  IFS=$'\t' read -r mount_type volume_name mount_source mount_rw <<< "$mount_rows"
  [[ "$mount_type" == "volume" && -n "$volume_name" && -n "$mount_source" ]] || \
    remote_fail 'the existing /data mount is not a Docker named volume.'
  [[ "$mount_rw" == "true" ]] || \
    remote_fail 'the existing /data named volume is not writable by the container.'

  container_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container_id")" || \
    remote_fail 'could not inspect the existing container Compose project label.'
  logical_volume="$(docker volume inspect --format '{{index .Labels "com.docker.compose.volume"}}' "$volume_name")" || \
    remote_fail "could not inspect named volume $volume_name."
  volume_project="$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume_name")" || \
    remote_fail "could not inspect named volume $volume_name project identity."
  volume_mountpoint="$(docker volume inspect --format '{{.Mountpoint}}' "$volume_name")" || \
    remote_fail "could not inspect named volume $volume_name mountpoint."
  [[ -n "$container_project" && "$container_project" != "<no value>" ]] || \
    remote_fail 'the existing container has no unambiguous Compose project identity.'
  [[ "$logical_volume" == "lytics-data" ]] || \
    remote_fail 'the existing /data volume is anonymous or is not the Compose lytics-data volume.'
  [[ "$volume_project" == "$container_project" ]] || \
    remote_fail 'the existing /data volume and lytics container have different Compose project identities.'
  [[ "$mount_source" == "$volume_mountpoint" ]] || \
    remote_fail 'the existing /data mount source does not match its named-volume mountpoint.'
  printf '%s\n' "$volume_name"
}

verify_existing_database() {
  local container_id=$1

  docker exec "$container_id" node -e '
    const fs = require("node:fs");
    const path = "/data/lytics.sqlite";
    const stat = fs.statSync(path);
    if (!stat.isFile()) throw new Error(`${path} is not a regular file`);
    fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK);
    const file = fs.openSync(path, "r+");
    fs.closeSync(file);
  ' >/dev/null || remote_fail \
    'existing /data/lytics.sqlite is missing or is not a regular readable/writable file.'
}

ensure_owned_stage() {
  local existing_marker_content

  if [[ -L "$stage_path" ]] || { [[ -e "$stage_path" ]] && [[ ! -d "$stage_path" ]]; }; then
    remote_fail "staged build context is ambiguous or not a real directory: $stage_path"
  fi

  if [[ ! -e "$stage_path" ]]; then
    mkdir -- "$stage_path" || remote_fail "could not create staged build context: $stage_path"
    umask 077
    (set -o noclobber; printf '%s\n' "$stage_marker_content" > "$stage_marker_path") || \
      remote_fail 'could not create the staged build context ownership marker.'
  else
    [[ -f "$stage_marker_path" && ! -L "$stage_marker_path" ]] || \
      remote_fail 'existing staged build context does not contain the required ownership marker.'
    existing_marker_content="$(<"$stage_marker_path")"
    [[ "$existing_marker_content" == "$stage_marker_content" ]] || \
      remote_fail 'existing staged build context ownership marker is invalid.'
  fi

  [[ -d "$stage_path" && ! -L "$stage_path" && -w "$stage_path" ]] || \
    remote_fail 'staged build context is not a real writable directory.'
}

[[ "$deploy_path" == /* && "$deploy_path" != "/" ]] || \
  remote_fail 'deployment path is not a safe absolute path.'
[[ -d "$deploy_path" ]] || remote_fail "deployment directory does not exist: $deploy_path"
[[ ! -L "$deploy_path" ]] || remote_fail 'deployment directory must not be a symbolic link.'
[[ -w "$deploy_path" ]] || remote_fail "deployment directory is not writable: $deploy_path"
cd -- "$deploy_path"

for source_path in app lib public; do
  if [[ -e "$source_path" ]] && { [[ ! -d "$source_path" ]] || [[ -L "$source_path" ]]; }; then
    remote_fail "production source destination is not a regular directory: $deploy_path/$source_path"
  fi
done

[[ -f .env && ! -L .env ]] || \
  remote_fail 'server-owned .env is missing, is not regular, or is a symbolic link.'
[[ -r .env ]] || remote_fail 'server-owned .env is not readable.'
[[ -f compose.yaml && ! -L compose.yaml ]] || \
  remote_fail 'existing compose.yaml is missing, is not regular, or is a symbolic link.'

command -v docker >/dev/null 2>&1 || remote_fail 'docker is not installed.'
docker info >/dev/null 2>&1 || remote_fail 'Docker Engine is not reachable.'
docker compose version >/dev/null 2>&1 || remote_fail 'Docker Compose plugin is unavailable.'
"${compose[@]}" config >/dev/null || \
  remote_fail 'docker compose config failed with the server-owned .env.'

geo_path="$({ "${compose[@]}" config --environment || exit 1; } | awk -F= '
  $1 == "LYTICS_GEOLITE2_CITY_HOST_PATH" {
    sub(/^[^=]*=/, "")
    print
    found++
  }
  END { if (found != 1) exit 1 }
')" || remote_fail 'could not resolve one GeoLite2 host path from Compose.'

[[ "$geo_path" == /* ]] || remote_fail 'Compose-resolved GeoLite2 host path is not absolute.'
[[ -f "$geo_path" ]] || remote_fail "GeoLite2 host path is not a regular file: $geo_path"
[[ -r "$geo_path" ]] || remote_fail "GeoLite2 host file is not readable: $geo_path"

container_id="$(running_service_container)"
data_volume="$(named_data_volume "$container_id")"
verify_existing_database "$container_id"
ensure_owned_stage

printf 'Remote preflight passed for %s using volume %s and marked stage %s.\n' \
  "$deploy_path" "$data_volume" "$stage_path" >&2
printf '%s\n' "$data_volume"
REMOTE_PREFLIGHT
)" || fail 'remote preflight did not establish a safe existing production data volume.'

[[ "$EXISTING_DATA_VOLUME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || \
  fail 'remote preflight returned an invalid Docker named-volume identity.'

PHASE="source transfer"

RSYNC_OPTIONS=(
  --archive
  --compress
  --itemize-changes
  --rsh="$RSYNC_SHELL"
)

STAGE_FILTERS=(
  --filter="protect /$STAGE_MARKER_NAME"
  --filter='hide .env'
  --filter='hide .env.*'
  --filter='hide *.sqlite'
  --filter='hide *.sqlite-*'
  --filter='hide *.db'
  --filter='hide *.db-*'
  --filter='hide *.mmdb'
  --filter='hide .git/'
  --filter='hide .github/'
  --filter='hide .codex/'
  --filter='hide .vscode/'
  --filter='hide .idea/'
  --filter='hide .DS_Store'
  --filter='hide *.swp'
  --filter='hide node_modules/'
  --filter='hide .next/'
  --filter='hide coverage/'
  --filter='hide dist/'
  --filter='hide *.tsbuildinfo'
  --filter='hide docs/'
  --filter='hide *.md'
  --filter='hide npm-debug.log*'
  --filter='hide yarn-debug.log*'
  --filter='hide yarn-error.log*'
  --filter='hide pnpm-debug.log*'
  --filter='include /.dockerignore'
  --filter='include /Dockerfile'
  --filter='include /package.json'
  --filter='include /package-lock.json'
  --filter='include /next.config.ts'
  --filter='include /next-env.d.ts'
  --filter='include /tsconfig.json'
  --filter='include /app/***'
  --filter='include /lib/***'
  --filter='include /public/***'
  --filter='hide /***'
)

# The only deletion boundary is the preflight-validated, marker-owned stage.
rsync "${RSYNC_OPTIONS[@]}" --delete "${STAGE_FILTERS[@]}" \
  ./ "$DEPLOY_HOST:$DEPLOY_PATH/$STAGE_DIRECTORY_NAME/"

# Compose remains in the stable production project directory and is never a
# deletion target.
rsync "${RSYNC_OPTIONS[@]}" compose.yaml "$DEPLOY_HOST:$DEPLOY_PATH/"

PHASE="remote build and update"

ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" bash -s -- \
  "$DEPLOY_PATH" "$EXISTING_DATA_VOLUME" "$STAGE_DIRECTORY_NAME" \
  "$STAGE_MARKER_NAME" "$STAGE_MARKER_CONTENT" <<'REMOTE_DEPLOY'
set -Eeuo pipefail

deploy_path=$1
expected_data_volume=$2
stage_directory_name=$3
stage_marker_name=$4
stage_marker_content=$5
stage_path="$deploy_path/$stage_directory_name"
stage_marker_path="$stage_path/$stage_marker_name"
cd -- "$deploy_path"

compose=(docker compose --env-file .env)

deploy_fail() {
  printf 'ERROR [remote deploy]: %s\n' "$*" >&2
  exit 1
}

show_logs() {
  printf '%s\n' '--- recent lytics logs (last 150 lines) ---' >&2
  "${compose[@]}" logs --no-color --tail=150 lytics >&2 || true
  printf '%s\n' '--- end recent lytics logs ---' >&2
}

validation_error() {
  printf 'ERROR [remote deploy]: %s\n' "$*" >&2
  return 1
}

running_service_container() {
  local container_count container_ids container_state

  container_ids="$("${compose[@]}" ps -a -q lytics)" || {
    validation_error 'could not resolve the lytics service container.'
    return 1
  }
  container_count="$(printf '%s\n' "$container_ids" | awk 'NF { count++ } END { print count + 0 }')"
  [[ "$container_count" == "1" ]] || {
    validation_error "expected exactly one lytics service container; found $container_count."
    return 1
  }
  container_state="$(docker inspect --format '{{.State.Running}}' "$container_ids")" || {
    validation_error 'could not inspect the lytics service container.'
    return 1
  }
  [[ "$container_state" == "true" ]] || {
    validation_error 'the lytics service container is not running.'
    return 1
  }
  printf '%s\n' "$container_ids"
}

named_data_volume() {
  local container_id=$1
  local container_project logical_volume mount_count mount_rows
  local mount_rw mount_source mount_type volume_mountpoint volume_name volume_project

  mount_rows="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{printf "%s\t%s\t%s\t%t\n" .Type .Name .Source .RW}}{{end}}{{end}}' "$container_id")" || {
    validation_error 'could not inspect /data mounts on the lytics container.'
    return 1
  }
  mount_count="$(printf '%s\n' "$mount_rows" | awk 'NF { count++ } END { print count + 0 }')"
  [[ "$mount_count" == "1" ]] || {
    validation_error "expected exactly one /data mount on the lytics container; found $mount_count."
    return 1
  }
  IFS=$'\t' read -r mount_type volume_name mount_source mount_rw <<< "$mount_rows"
  [[ "$mount_type" == "volume" && -n "$volume_name" && -n "$mount_source" ]] || {
    validation_error 'the /data mount is not a Docker named volume.'
    return 1
  }
  [[ "$mount_rw" == "true" ]] || {
    validation_error 'the /data named volume is not writable.'
    return 1
  }

  container_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container_id")" || {
    validation_error 'could not inspect the container Compose project label.'
    return 1
  }
  logical_volume="$(docker volume inspect --format '{{index .Labels "com.docker.compose.volume"}}' "$volume_name")" || {
    validation_error "could not inspect named volume $volume_name."
    return 1
  }
  volume_project="$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume_name")" || {
    validation_error "could not inspect named volume $volume_name project identity."
    return 1
  }
  volume_mountpoint="$(docker volume inspect --format '{{.Mountpoint}}' "$volume_name")" || {
    validation_error "could not inspect named volume $volume_name mountpoint."
    return 1
  }
  [[ -n "$container_project" && "$container_project" != "<no value>" ]] || {
    validation_error 'the container has no unambiguous Compose project identity.'
    return 1
  }
  [[ "$logical_volume" == "lytics-data" ]] || {
    validation_error 'the /data volume is anonymous or is not the Compose lytics-data volume.'
    return 1
  }
  [[ "$volume_project" == "$container_project" ]] || {
    validation_error 'the /data volume and lytics container have different Compose project identities.'
    return 1
  }
  [[ "$mount_source" == "$volume_mountpoint" ]] || {
    validation_error 'the /data mount source does not match its named-volume mountpoint.'
    return 1
  }
  printf '%s\n' "$volume_name"
}

verify_existing_database() {
  local container_id=$1

  docker exec "$container_id" node -e '
    const fs = require("node:fs");
    const path = "/data/lytics.sqlite";
    const stat = fs.statSync(path);
    if (!stat.isFile()) throw new Error(`${path} is not a regular file`);
    fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK);
    const file = fs.openSync(path, "r+");
    fs.closeSync(file);
  ' >/dev/null || {
    validation_error '/data/lytics.sqlite is missing or is not a regular readable/writable file.'
    return 1
  }
}

validate_owned_stage() {
  local existing_marker_content

  [[ -d "$stage_path" && ! -L "$stage_path" && -w "$stage_path" ]] || {
    validation_error 'staged build context is not a real writable directory.'
    return 1
  }
  [[ -f "$stage_marker_path" && ! -L "$stage_marker_path" ]] || {
    validation_error 'staged build context ownership marker is missing or ambiguous.'
    return 1
  }
  existing_marker_content="$(<"$stage_marker_path")"
  [[ "$existing_marker_content" == "$stage_marker_content" ]] || {
    validation_error 'staged build context ownership marker is invalid.'
    return 1
  }
}

emit_build_override() {
  printf 'services:\n  lytics:\n    build:\n      context: "%s"\n      dockerfile: Dockerfile\n' \
    "$stage_path"
}

# Revalidate the newly transferred Compose inputs before changing the service.
"${compose[@]}" config >/dev/null || \
  deploy_fail 'docker compose config failed after source transfer.'

geo_path="$({ "${compose[@]}" config --environment || exit 1; } | awk -F= '
  $1 == "LYTICS_GEOLITE2_CITY_HOST_PATH" {
    sub(/^[^=]*=/, "")
    print
    found++
  }
  END { if (found != 1) exit 1 }
')" || deploy_fail 'could not resolve one GeoLite2 host path after source transfer.'
[[ "$geo_path" == /* && -f "$geo_path" && -r "$geo_path" ]] || \
  deploy_fail 'Compose-resolved GeoLite2 host file failed post-transfer validation.'

current_container="$(running_service_container)" || \
  deploy_fail 'existing lytics service validation failed immediately before build.'
current_data_volume="$(named_data_volume "$current_container")" || \
  deploy_fail 'existing /data named-volume validation failed immediately before build.'
[[ "$current_data_volume" == "$expected_data_volume" ]] || \
  deploy_fail "data volume changed before build (expected $expected_data_volume, found $current_data_volume)."
verify_existing_database "$current_container" || \
  deploy_fail 'existing SQLite validation failed immediately before build.'
validate_owned_stage || deploy_fail 'staged build context validation failed before build.'

build_compose=(docker compose --env-file .env -f compose.yaml -f -)
emit_build_override | "${build_compose[@]}" config >/dev/null || \
  deploy_fail 'merged staged-build Compose configuration is invalid.'

printf '%s\n' 'Building the lytics image while the current service remains running...'
if ! emit_build_override | "${build_compose[@]}" build lytics; then
  deploy_fail 'image build failed; the existing lytics service was not updated.'
fi

if ! "${compose[@]}" up -d --no-build lytics; then
  show_logs
  deploy_fail 'service update failed after the image was built.'
fi

if ! replacement_container="$(running_service_container)"; then
  show_logs
  deploy_fail 'updated lytics service is missing or not running.'
fi
if ! replacement_data_volume="$(named_data_volume "$replacement_container")"; then
  show_logs
  deploy_fail 'updated lytics service has an invalid /data mount.'
fi
if [[ "$replacement_data_volume" != "$expected_data_volume" ]]; then
  show_logs
  deploy_fail \
    "updated lytics service mounted $replacement_data_volume instead of existing volume $expected_data_volume."
fi

probe_passed=false
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$replacement_container" 2>/dev/null || true)" == "true" ]] &&
    docker exec -i "$replacement_container" node <<'NODE_PROBE'
const fs = require("node:fs");

async function probe() {
  const response = await fetch("http://127.0.0.1:3000/", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`GET / returned HTTP ${response.status}`);
  }

  const timeZone = process.env.LYTICS_TIME_ZONE;
  if (!timeZone) {
    throw new Error("LYTICS_TIME_ZONE is not configured");
  }
  new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());

  const databasePath = process.env.LYTICS_DATABASE_PATH;
  if (databasePath !== "/data/lytics.sqlite") {
    throw new Error(`unexpected SQLite path: ${databasePath || "unset"}`);
  }
  const databaseStat = fs.statSync(databasePath);
  if (!databaseStat.isFile()) {
    throw new Error("SQLite path is not a regular file");
  }
  fs.accessSync(databasePath, fs.constants.R_OK | fs.constants.W_OK);
  const databaseFile = fs.openSync(databasePath, "r+");
  fs.closeSync(databaseFile);

  const geoPath = process.env.LYTICS_GEOLITE2_CITY_PATH;
  if (!geoPath) {
    throw new Error("LYTICS_GEOLITE2_CITY_PATH is not configured");
  }
  const geoStat = fs.statSync(geoPath);
  if (!geoStat.isFile()) {
    throw new Error("GeoLite2 mount is not a regular file");
  }
  fs.accessSync(geoPath, fs.constants.R_OK);
  const geoFile = fs.openSync(geoPath, "r");
  try {
    const byte = Buffer.alloc(1);
    if (fs.readSync(geoFile, byte, 0, 1, 0) !== 1) {
      throw new Error("GeoLite2 mount is empty or unreadable");
    }
  } finally {
    fs.closeSync(geoFile);
  }
}

probe().catch((error) => {
  console.error(`health probe failed: ${error.message}`);
  process.exit(1);
});
NODE_PROBE
  then
    probe_passed=true
    break
  fi

  printf 'Health check attempt %s/12 has not passed yet.\n' "$attempt"
  sleep 5
done

if [[ "$probe_passed" != "true" ]]; then
  show_logs
  deploy_fail 'service did not pass bounded startup and in-container health checks.'
fi

if ! final_container="$(running_service_container)"; then
  show_logs
  deploy_fail 'lytics service changed or stopped during health verification.'
fi
if ! final_data_volume="$(named_data_volume "$final_container")"; then
  show_logs
  deploy_fail 'lytics service /data mount became invalid during health verification.'
fi
if [[ "$final_data_volume" != "$expected_data_volume" ]]; then
  show_logs
  deploy_fail \
    "lytics service no longer mounts existing data volume $expected_data_volume."
fi

"${compose[@]}" ps lytics
printf '%s\n' 'SUCCESS: lytics was deployed and all startup checks passed.'
REMOTE_DEPLOY
