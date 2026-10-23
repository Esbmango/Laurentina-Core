"""Independent installs must never share a loopback listener on Windows."""
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from urllib.request import build_opener, ProxyHandler

import app


class FakeService:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.config = dict(app.DEFAULTS)

    def close(self):
        pass


class ServerBindingTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    @staticmethod
    def close(server):
        server.close_memories()
        server.server_close()

    def test_existing_owner_cannot_be_rebound_or_receive_second_owner_token(self):
        first = app.AppServer(("127.0.0.1", 0), FakeService(self.directory / "first"))
        thread = threading.Thread(target=first.serve_forever, kwargs={"poll_interval": .05}, daemon=True)
        thread.start()
        try:
            with self.assertRaises(OSError):
                second = app.AppServer(first.server_address, FakeService(self.directory / "second"))
                self.close(second)
            # The failed bind did not disrupt the original listener.
            opener = build_opener(ProxyHandler({}))
            with opener.open("http://127.0.0.1:%d/api/status" % first.server_port, timeout=3) as response:
                status = json.load(response)
            self.assertEqual(status["token"], first.token)
            self.assertFalse((self.directory / "second/hermes-writes.db").exists())
            if os.name == "nt":
                self.assertFalse(first.allow_reuse_address)
                self.assertEqual(first.socket.getsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE), 1)
        finally:
            first.shutdown()
            thread.join(2)
            self.close(first)

    @unittest.skipUnless(os.name == "nt", "Windows legacy SO_REUSEADDR regression")
    def test_exclusive_bind_rejects_preexisting_legacy_reuse_listener(self):
        # Older installed versions used HTTPServer's SO_REUSEADDR default.
        # A new installation must fail this port and try the next one.
        with socket.socket() as legacy:
            legacy.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            legacy.bind(("127.0.0.1", 0))
            legacy.listen(1)
            with self.assertRaises(OSError):
                server = app.AppServer(legacy.getsockname(), FakeService(self.directory / "new"))
                self.close(server)
            available = app.AppServer(("127.0.0.1", 0), FakeService(self.directory / "available"))
            try:
                self.assertNotEqual(available.server_port, legacy.getsockname()[1])
            finally:
                self.close(available)


if __name__ == "__main__":
    unittest.main()
