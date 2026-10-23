"""Probe only the two local Ollama models, without cloud APIs or user messages."""
import json
import time
from urllib.request import Request, urlopen


def local_post(path, payload):
    started = time.monotonic()
    request = Request("http://127.0.0.1:11434" + path,
                      data=json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=240) as response:
        result = json.load(response)
    return result, round(time.monotonic() - started, 2)


if __name__ == "__main__":
    chat, elapsed = local_post("/v1/chat/completions", {
        "model": "qwen3.5:9b", "messages": [{"role": "user", "content": "请只回复：本地模型已就绪。"}],
        "reasoning_effort": "none", "temperature": 0.1, "max_tokens": 80,
    })
    text = chat["choices"][0]["message"].get("content", "")
    assert text.strip(), chat
    print(json.dumps({"chat_response": text, "seconds": elapsed}, ensure_ascii=False), flush=True)
    embedding, elapsed = local_post("/v1/embeddings", {
        "model": "qwen3-embedding:0.6b", "input": ["劳纶缇娜的记忆测试"],
        "dimensions": 1024, "encoding_format": "float",
    })
    dimensions = len(embedding["data"][0]["embedding"])
    assert dimensions == 1024, dimensions
    print(json.dumps({"embedding_dimensions": dimensions, "seconds": elapsed}), flush=True)
