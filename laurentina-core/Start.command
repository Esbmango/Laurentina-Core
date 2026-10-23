#!/bin/sh
set -eu
core_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
memory_dir=${LAURENTINA_MEMORY_HOME:-"$(dirname -- "$core_dir")/hy-memory-starter"}
core_python=${LAURENTINA_CORE_PYTHON:-"$memory_dir/.venv/bin/python"}
if [ ! -x "$core_python" ]; then
  printf '%s\n' 'Python runtime missing. Run Setup.command first. / 请先运行 Setup.command。' >&2
  exit 1
fi
exec "$core_python" -B -E -s -X utf8 "$core_dir/launch.pyw"
