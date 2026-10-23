#!/bin/sh
set -eu
export PYTHONDONTWRITEBYTECODE=1
test "$(uname -s)" = Darwin
core_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
memory_dir=${LAURENTINA_MEMORY_HOME:-"$(dirname -- "$core_dir")/hy-memory-starter"}
base_python=${LAURENTINA_CORE_PYTHON:-"$memory_dir/.venv/bin/python"}
if [ ! -x "$base_python" ]; then
  printf '%s\n' 'Run Setup.command before installing optional voice.' >&2
  exit 1
fi
if [ "${1:-basic}" = custom ]; then
  exec "$base_python" -B -E -s -X utf8 "$core_dir/setup_custom_voice.py"
fi
environment=$("$base_python" -B -E -s -X utf8 -c 'import sys; sys.path.insert(0,sys.argv[1]); from core_platform import voice_environment; print(voice_environment(sys.argv[1],".voice-venv"))' "$core_dir")
voice_python="$environment/bin/python"
if [ ! -x "$voice_python" ]; then
  "$base_python" -B -E -s -m venv "$environment"
fi
"$voice_python" -B -E -s -m pip install --disable-pip-version-check --no-input -r "$core_dir/requirements-voice-lock.txt"
"$voice_python" -B -E -s -m pip check
"$voice_python" -B -E -s -X utf8 "$core_dir/setup_voice_models.py"
printf '%s\n' 'Local CPU voice installed. Metal/MPS acceleration has not been enabled or validated.'
