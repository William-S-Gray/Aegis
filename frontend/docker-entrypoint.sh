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

echo "aegis: runtime config written to $CONFIG_PATH (API_URL=${API_URL:-<unset>})"
