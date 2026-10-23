#!/bin/sh
set -eu
export PYTHONDONTWRITEBYTECODE=1
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'This installer is for macOS. On Windows use Setup.cmd.' >&2
  exit 1
fi
core_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
memory_dir=${LAURENTINA_MEMORY_HOME:-"$(dirname -- "$core_dir")/hy-memory-starter"}
skip_npm=0
skip_memory=0
base_python=${LAURENTINA_MEMORY_PYTHON:-python3.12}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-npm) skip_npm=1 ;;
    --skip-memory-defaults) skip_memory=1 ;;
    --python) shift; base_python=${1:?--python requires an executable} ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
if [ ! -f "$memory_dir/app.py" ]; then
  printf '%s\n' 'Keep laurentina-core and hy-memory-starter beside each other.' >&2
  exit 1
fi
"$base_python" -B -E -s -c 'import sys,platform; assert sys.version_info[:2] == (3,12), "Python 3.12 is required"; assert platform.machine() == "arm64", "This preview requires native Apple Silicon Python"'
project_python="$memory_dir/.venv/bin/python"
if [ ! -x "$project_python" ]; then
  "$base_python" -B -E -s -m venv "$memory_dir/.venv"
fi
"$project_python" -B -E -s -c 'import sys; assert sys.version_info[:2] == (3,12), "Recreate the project venv using Python 3.12"'
"$project_python" -B -E -s -m pip install --disable-pip-version-check -c "$memory_dir/requirements.lock.txt" -r "$memory_dir/requirements.txt" -r "$core_dir/requirements.txt"
"$project_python" -B -E -s -m pip check
if [ "$skip_npm" -eq 0 ]; then
  node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
  (cd "$core_dir" && npm ci --include=dev --no-audit --no-fund)
  if [ ! -x "$core_dir/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
    node "$core_dir/node_modules/electron/install.js"
  fi
  test -x "$core_dir/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
fi
if [ "$skip_memory" -eq 0 ]; then
  "$project_python" -B -E -s -X utf8 "$core_dir/scripts/configure_local_memory.py" --initialize
fi
printf '%s\n' 'Core ready. Run Start.command. Local models and optional voice are installed separately.'
