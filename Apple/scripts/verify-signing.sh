#!/bin/bash
set -euo pipefail
expected='U48VX8D6WT'
# Scheme post-actions run after CodeSign but do not receive target build settings.
app="${1:-${TARGET_BUILD_DIR:-}/${WRAPPER_NAME:-}}"
if [[ ! -d "$app" ]]; then echo "error: built app not found for signing verification" >&2; exit 1; fi
# Simulator and explicitly unsigned QA builds are not signed; there is no identity to verify.
if ! actual=$(/usr/bin/codesign -dvvv "$app" 2>&1 | /usr/bin/sed -n 's/^TeamIdentifier=//p' | /usr/bin/tail -1); then exit 0; fi
if [[ -z "$actual" || "$actual" == 'not set' ]]; then exit 0; fi
if [[ "$actual" != "$expected" ]]; then
  echo "error: built app TeamIdentifier '$actual' does not match required $expected" >&2
  exit 1
fi
