#!/bin/sh
set -eu
core_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$core_dir/scripts/setup_voice_macos.sh" custom
