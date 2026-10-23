"""Use Hermes' native post-update activation service for the installed bridge."""
import json
from pathlib import Path
import unittest
from platform_support import project_home, project_data


class ActivateInstalledBridge(unittest.TestCase):
    def test_activate(self):
        from hermes_cli.plugins_activation import activate_plugin_now
        result = activate_plugin_now("laurentina_desktop_bridge",in_process=False)
        activation = result.get("activation")
        self.assertIsNotNone(activation,"Hermes Desktop did not acknowledge plugin activation")
        root = project_home("memory", Path(__file__).resolve().parent)
        (project_data("memory", root)/"desktop-plugin-activation.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
        print(json.dumps({"desktop_acknowledged":True,"plugin":activation.get("name"),"restart_required":result.get("restart_required")},ensure_ascii=False))
