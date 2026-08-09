#!/usr/bin/env bash
#
# Prove a backup can actually be restored.
#
#   scripts/verify-backup.sh <dump-file>
#
# Restores into a throwaway database, counts rows in the tables that matter,
# and drops it again. Run this on a schedule: an untested backup is a guess.
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

DUMP="${1:?usage: verify-backup.sh <dump-file>}"
ADMIN_URL="${VERIFY_ADMIN_URL:-postgresql://aegis:aegis@localhost:5435/postgres}"
SCRATCH_DB="aegis_verify_$(date -u +%s)"

PLAIN=""
cleanup() {
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null 2>&1 || true
  # Verifying an encrypted backup must not leave plaintext behind.
  if [[ -n "$PLAIN" && "$PLAIN" != "$DUMP" ]]; then
    shred -u "$PLAIN" 2>/dev/null || rm -f "$PLAIN"
  fi
}
trap cleanup EXIT

# Checksums are taken over the stored artefact.
if [[ -f "$DUMP.sha256" ]]; then
  echo "Verifying checksum..."
  sha256sum --check "$DUMP.sha256"
fi

PLAIN="$(maybe_decrypt "$DUMP")"

echo "Creating scratch database $SCRATCH_DB"
psql "$ADMIN_URL" -q -c "CREATE DATABASE $SCRATCH_DB;"

TARGET_URL="${ADMIN_URL%/*}/$SCRATCH_DB"
pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" "$PLAIN" >/dev/null

echo "Row counts in the restored copy:"
psql "$TARGET_URL" -qAt -F' ' -c "
  SELECT 'users', count(*) FROM users
  UNION ALL SELECT 'vehicles', count(*) FROM vehicles
  UNION ALL SELECT 'alerts', count(*) FROM alerts
  UNION ALL SELECT 'access_logs', count(*) FROM access_logs
  UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
  ORDER BY 1;" | sed 's/^/  /'

# A restore that produces an empty users table is a restore that would not get
# you back online.
USERS="$(psql "$TARGET_URL" -qAt -c 'SELECT count(*) FROM users;')"
if [[ "$USERS" -lt 1 ]]; then
  echo "FAILED: restored database has no users" >&2
  exit 1
fi

echo "Backup verified: restores cleanly and contains data."
