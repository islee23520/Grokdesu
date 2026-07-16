#!/bin/bash
set -euo pipefail
team="${DEVELOPMENT_TEAM:-}"
if [[ "$team" != "U48VX8D6WT" || "$team" == "5225UR99YD" ]]; then echo "Invalid DEVELOPMENT_TEAM: expected U48VX8D6WT" >&2; exit 1; fi
root="${SRCROOT}"
out="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/omodesu-gateway"
mkdir -p "$(dirname "$out")"
cd "$root"
OMODESU_STATIC_ROOT='' bun build apps/gateway/src/index.ts --compile --target=bun-darwin-arm64 --outfile "$out"
chmod +x "$out"
