"""Use standard MCP stdio with the installed desktop app's own MCP server."""
from codex_rpc import CodexRPC


class MCPClient(CodexRPC):
    def __init__(self, command, *, env_extra=None):
        super().__init__(command=command, env_extra=env_extra,
            initialize_params={"protocolVersion": "2024-11-05", "capabilities": {},
                "clientInfo": {"name": "laurentina-bridge", "version": "0.1.0"}},
            initialized_method="notifications/initialized")

    def send(self, message):
        return super().send({"jsonrpc": "2.0", **message})

    def tool(self, name, arguments, *, metadata=None, timeout=120):
        params = {"name": name, "arguments": arguments}
        if metadata:
            params["_meta"] = metadata
        result = self.call("tools/call", params, timeout=timeout)
        if result.get("isError"):
            error = " ".join(item.get("text", "") for item in result.get("content", []) if item.get("type") == "text")
            raise RuntimeError(error[:1200] or "The application refused this request.")
        return result
