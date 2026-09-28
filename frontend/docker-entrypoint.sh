#!/bin/sh
# Writes runtime configuration the app reads on boot.
#
# Vite inlines import.meta.env at build time, so without this the image would
# be tied to whichever API URL was set when it was compiled. Generating
# config.js here lets one image promote unchanged from staging to production.
set -eu

CONFIG_PATH="/usr/share/nginx/html/config.js"

cat > "$CONFIG_PATH" <<JS
window.__AEGIS_CONFIG__ = {
  API_URL: "${API_URL:-}",
  WS_URL: "${WS_URL:-}",
  MEDIA_URL: "${MEDIA_URL:-}",
  ENABLE_MOCK_AUTH: "${ENABLE_MOCK_AUTH:-false}"
};
JS

# Content-Security-Policy, built from the same origins. Scripts are
# same-origin only; styles allow inline because Chakra/emotion inject <style>
# tags at runtime. The API, WebSocket and media origins are the only other
# places the page may talk to.
origin() { printf '%s' "$1" | sed -nE 's#^(https?|wss?)://([^/]+).*#\1://\2#p'; }
API_ORIGIN="$(origin "${API_URL:-}")"
WS_ORIGIN="$(origin "${WS_URL:-}")"
if [ -z "$WS_ORIGIN" ] && [ -n "$API_ORIGIN" ]; then
  WS_ORIGIN="$(printf '%s' "$API_ORIGIN" | sed 's#^http#ws#')"
fi
MEDIA_ORIGIN="$(origin "${MEDIA_URL:-}")"

cat > /etc/nginx/conf.d/csp.inc <<CONF
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${MEDIA_ORIGIN}; media-src 'self' data:; connect-src 'self' ${API_ORIGIN} ${WS_ORIGIN}; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
CONF

echo "aegis: runtime config written to $CONFIG_PATH (API_URL=${API_URL:-<unset>})"
