# Sourced by the backup scripts; not run directly.
#
# pg_url_split URL
#   Sets PG_URL to URL in libpq form with the password removed, and exports the
#   password as PGPASSWORD. A password on the command line is visible to every
#   user on the host through ps; the environment is readable only by the owner.
pg_url_split() {
  local url="${1/postgresql+psycopg:\/\//postgresql://}"
  local re='^(postgres(ql)?://[^:@/]*):(.*)@([^@]*)$'
  if [[ "$url" =~ $re ]]; then
    local pw="${BASH_REMATCH[3]}"
    pw="${pw//\\/\\\\}"                          # keep literal backslashes
    printf -v PGPASSWORD '%b' "${pw//%/\\x}"     # percent-decode
    export PGPASSWORD
    url="${BASH_REMATCH[1]}@${BASH_REMATCH[4]}"
  fi
  PG_URL="$url"
}
