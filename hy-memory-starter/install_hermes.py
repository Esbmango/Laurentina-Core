"""Install a user memory provider using Hermes' own configuration writer.

The command-line installer uses Hermes' published CLI to activate the provider.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys

from platform_support import project_home, project_data, runtime_python

ROOT = project_home("memory", Path(__file__).resolve().parent)


def memory_activation_patch(config):
    patch = {"memory": {"provider": "hymemory"}}
    disabled = config.get("agent", {}).get("disabled_toolsets")
    if isinstance(disabled, list) and "memory" in disabled:
        patch["agent"] = {"disabled_toolsets": [name for name in disabled if name != "memory"]}
    cli = config.get("platform_toolsets", {}).get("cli")
    if isinstance(cli, list) and "memory" not in cli:
        patch["platform_toolsets"] = {"cli": [*cli, "memory"]}
    return patch


def install_for(home, activate=True):
    home = Path(home).resolve()
    destination = home / "plugins" / "hymemory"
    config_path = home / "config.yaml"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = home / "backups" / ("hymemory-" + stamp)
    backup.mkdir(parents=True, exist_ok=True)
    if config_path.exists():
        shutil.copy2(config_path, backup / "config.yaml")
    if destination.exists():
        shutil.copytree(destination, backup / "plugin", dirs_exist_ok=True)
    destination.mkdir(parents=True, exist_ok=True)
    for name in ("__init__.py", "plugin.yaml", "README.md"):
        shutil.copy2(ROOT / "hermes_plugin" / name, destination / name)
    (destination / "sidecar.json").write_text(json.dumps({"workspace": str(ROOT), "python": str(runtime_python("memory", ROOT)), "data_dir": str(project_data("memory", ROOT))}, indent=2), encoding="utf-8")
    if activate:
        from hermes_cli.config import read_raw_config, save_config
        # A partial merge preserves model, tools, identity, credentials and other settings.
        save_config(memory_activation_patch(read_raw_config()), merge_existing=True)
    return {"home": str(home), "provider": "hymemory", "backup": str(backup)}


if __name__ == "__main__":
    import argparse
    import os
    import subprocess
    import yaml
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", required=True)
    options = parser.parse_args()
    home = Path(options.home).resolve()
    result = install_for(home, activate=False)
    env = dict(os.environ)
    env["HERMES_HOME"] = str(home)
    config = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8")) or {}
    for section, settings in memory_activation_patch(config).items():
        for key, value in settings.items():
            argument = value if isinstance(value, str) else json.dumps(value)
            subprocess.run([str(home / "bin" / ("hermes.exe" if sys.platform == "win32" else "hermes")), "config", "set", f"{section}.{key}", argument],
                           env=env, check=True, timeout=120)
    print(json.dumps(result, ensure_ascii=False), flush=True)
