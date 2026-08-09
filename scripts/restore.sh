#!/usr/bin/env bash
#
# Restore a backup into a target database.
#
#   scripts/restore.sh <dump-file> <target-database-url>
#
# The target is REQUIRED and explicit: defaulting it to DATABASE_URL would make
# a mistyped command overwrite production.
set -euo pipefail

# Decrypt into a private temp file when the artefact is encrypted. The
# plaintext never touches the backup directory and is removed on exit.
maybe_decrypt() {
  local src="$1"
  case "$src" in
    *.age)
      command -v age >/dev/null 2>&1 || { echo "age is required to decrypt $src" >&2; exit 1; }
      local out; out="$(mktemp -t aegis-restore-XXXXXX.dump)"
      age --decrypt --identity "${BACKUP_IDENTITY:?BACKUP_IDENTITY (age key file) is required}" \
          --output "$out" "$src"
      echo "$out"
      ;;
    *.gpg)
      command -v gpg >/dev/null 2>&1 || { echo "gpg is required to decrypt $src" >&2; exit 1; }
      local out; out="$(mktemp -t aegis-restore-XXXXXX.dump)"
      gpg --batch --yes --quiet --output "$out" --decrypt "$src"
      echo "$out"
      ;;
    *)
      echo "$src"
      ;;
  esac
}

DUMP="${1:?usage: restore.sh <dump-file> <target-database-url>}"
TARGET_URL="${2:?usage: restore.sh <dump-file> <target-database-url>}"

if [[ ! -f "$DUMP" ]]; then
  echo "No such dump: $DUMP" >&2
  exit 1
fi

if [[ -f "$DUMP.sha256" ]]; then
  echo "Verifying checksum..."
  sha256sum --check "$DUMP.sha256"
fi

PG_URL="${TARGET_URL/postgresql+psycopg:\/\//postgresql://}"

PLAIN="$(maybe_decrypt "$DUMP")"
if [[ "$PLAIN" != "$DUMP" ]]; then
  trap 'shred -u "$PLAIN" 2>/dev/null || rm -f "$PLAIN"' EXIT
fi

echo "Restoring $DUMP into $PG_URL"
# --clean --if-exists makes the restore repeatable into a non-empty database.
pg_restore --clean --if-exists --no-owner --no-privileges \
           --dbname="$PG_URL" "$PLAIN"

echo "Restore complete."
