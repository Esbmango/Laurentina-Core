"""Load the shared OS boundary from the adjacent HyMemory source directory."""
import importlib.util
import os
from pathlib import Path
import sys

_core = Path(os.environ.get("LAURENTINA_CORE_HOME", Path(__file__).resolve().parent)).expanduser().resolve()
_memory = Path(os.environ.get("LAURENTINA_MEMORY_HOME", _core.parent / "hy-memory-starter")).expanduser().resolve()
_path = _memory / "platform_support.py"
_name = "laurentina_platform_support"
_module = sys.modules.get(_name)
if _module is None or Path(_module.__file__).resolve() != _path:
    _spec = importlib.util.spec_from_file_location(_name, _path)
    _module = importlib.util.module_from_spec(_spec)
    sys.modules[_name] = _module
    _spec.loader.exec_module(_module)
for _symbol in _module.__all__:
    globals()[_symbol] = getattr(_module, _symbol)
__all__ = list(_module.__all__)
