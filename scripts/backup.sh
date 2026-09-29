#!/usr/bin/env bash
#
# Take a compressed, optionally encrypted logical backup of the Aegis database.
#
#   scripts/backup.sh [output-directory]
#
# Reads DATABASE_URL from the environment or .env. Uses pg_dump's custom
# format (-Fc), which is compressed and lets pg_restore select individual
# objects — a plain SQL dump gives you neither.
#
# Encryption (strongly recommended: a dump contains every plate you have ever
# seen) is enabled by setting BACKUP_ENCRYPT_TO to a recipient:
#
#   BACKUP_ENCRYPT_TO=ops@example.com        # gpg key id, uid, or fingerprint
#   BACKUP_ENCRYPT_TO=age1qz...              # age recipient
#
# Encryption is ASYMMETRIC on purpose. The backup host holds only the public
# key, so an attacker who compromises it cannot read the backups it produced.
# Keep the private key somewhere the backup host cannot reach.
#
# Off-box copy: set BACKUP_UPLOAD_CMD to any command taking the file path,
# e.g. 'aws s3 cp {} s3://bucket/aegis/' or 'rclone copyto {} remote:aegis/'.
# {} is replaced with the path. A backup on the same disk as the database is
# not a backup.
#
# A backup nobody has restored is not a backup either. Run
# scripts/verify-backup.sh on a schedule, not just after an incident.
set -euo pipefail

OUT_DIR="${1:-./backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  # shellcheck disable=SC2046
  export $(grep -E '^DATABASE_URL=' .env | xargs -d '\n')
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

source "$(dirname "${BASH_SOURCE[0]}")/pg-url.sh"
pg_url_split "$DATABASE_URL"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$OUT_DIR/aegis-$STAMP.dump"

echo "Backing up to $TARGET"
# Restrictive umask: the dump exists on disk before it is encrypted.
(umask 077 && pg_dump --format=custom --compress=9 --no-owner --no-privileges \
                      --file="$TARGET" "$PG_URL")

encrypt() {
  local plain="$1"
  if command -v age >/dev/null 2>&1; then
    age --recipient "$BACKUP_ENCRYPT_TO" --output "$plain.age" "$plain"
    echo "$plain.age"
  elif command -v gpg >/dev/null 2>&1; then
    gpg --batch --yes --trust-model always \
        --recipient "$BACKUP_ENCRYPT_TO" \
        --output "$plain.gpg" --encrypt "$plain"
    echo "$plain.gpg"
  else
    echo "BACKUP_ENCRYPT_TO is set but neither age nor gpg is installed" >&2
    return 1
  fi
}

if [[ -n "${BACKUP_ENCRYPT_TO:-}" ]]; then
  ENCRYPTED="$(encrypt "$TARGET")"
  # Remove the plaintext only once the ciphertext exists.
  shred -u "$TARGET" 2>/dev/null || rm -f "$TARGET"
  TARGET="$ENCRYPTED"
  echo "Encrypted to $TARGET"
else
  echo "WARNING: BACKUP_ENCRYPT_TO is not set — this dump is UNENCRYPTED." >&2
fi

# Checksum the artefact that is actually stored, so silent corruption on the
# storage medium is detectable before a restore is attempted under pressure.
sha256sum "$TARGET" > "$TARGET.sha256"

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "Wrote $TARGET ($SIZE)"

if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
  echo "Uploading off-box..."
  for f in "$TARGET" "$TARGET.sha256"; do
    # shellcheck disable=SC2086
    ${BACKUP_UPLOAD_CMD//\{\}/"$f"}
  done
  echo "Upload complete."
else
  echo "NOTE: BACKUP_UPLOAD_CMD is not set — this backup stays on this host." >&2
fi

if [[ "$RETAIN_DAYS" -gt 0 ]]; then
  find "$OUT_DIR" -name 'aegis-*.dump*' -type f -mtime "+$RETAIN_DAYS" -print -delete
fi
