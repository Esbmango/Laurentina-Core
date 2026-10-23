"""Memory policy tests; never loads a real speech or GPU model."""
from collections import OrderedDict
import gc
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import core_voice_worker as worker


class MemoryTests(unittest.TestCase):
    def test_full_cache_releases_old_model_before_loading_replacement(self):
        alive = set()
        class Model:
            def __init__(self, name): self.name = name; alive.add(name)
            def __del__(self): alive.discard(self.name)
        cache = OrderedDict()
        worker._cached(cache, ("first",), lambda: Model("first"), 1)
        def replacement():
            self.assertEqual(alive, set(), "a full ASR cache must not keep old weights while allocating replacement weights")
            return Model("second")
        worker._cached(cache, ("second",), replacement, 1)
        self.assertEqual(alive, {"second"})

    def test_changed_voice_file_or_policy_does_not_keep_duplicate_weights(self):
        cache = OrderedDict()
        first = object()
        worker._cached(cache, ("voice.onnx", "v1"), lambda: first, 2)
        worker._cached(cache, ("voice.onnx", "v2"), object, 2)
        self.assertEqual(list(cache), [("voice.onnx", "v2")])

    def test_piper_uses_bounded_cpu_threads_and_low_memory_allocator(self):
        class Options:
            enable_cpu_mem_arena = True
            enable_mem_pattern = True
        calls = []
        def session(path, **kwargs): calls.append(kwargs); return object()
        piper = SimpleNamespace(PiperConfig=SimpleNamespace(from_dict=lambda value: value), PiperVoice=lambda **kwargs: kwargs)
        ort = SimpleNamespace(SessionOptions=Options, InferenceSession=session)
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "voice.onnx"
            Path(str(model) + ".json").write_text("{}")
            with patch.dict("sys.modules", {"piper": piper, "onnxruntime": ort}):
                worker._load_piper(model, "low_memory")
        options = calls[0]["sess_options"]
        self.assertGreaterEqual(options.intra_op_num_threads, 1)
        self.assertLessEqual(options.intra_op_num_threads, 4)
        self.assertEqual(options.inter_op_num_threads, 1)
        self.assertFalse(options.enable_cpu_mem_arena)
        self.assertFalse(options.enable_mem_pattern)
        self.assertEqual(calls[0]["providers"], ["CPUExecutionProvider"])


if __name__ == "__main__":
    unittest.main()
