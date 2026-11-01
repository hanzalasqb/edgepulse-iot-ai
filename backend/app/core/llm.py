"""Streaming client for any OpenAI-compatible Chat Completions API with tool calling."""
import json
from collections.abc import AsyncIterator
from typing import Protocol

import httpx

from app.core.config import Settings, get_settings


class LLMClient(Protocol):
    def stream(self, messages: list[dict], tools: list[dict] | None = None) -> AsyncIterator[dict]:
        """Yield {"type": "token", "text"} events, then one {"type": "tool_calls", "calls"} if tools were requested."""
        ...


class OpenAICompatibleLLM:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def stream(self, messages: list[dict], tools: list[dict] | None = None) -> AsyncIterator[dict]:
        payload: dict = {"model": self.settings.llm_model, "messages": messages, "stream": True, "temperature": 0.2}
        if tools:
            payload["tools"] = tools
        headers = {"Authorization": f"Bearer {self.settings.llm_api_key}"}
        calls: dict[int, dict] = {}
        async with httpx.AsyncClient(base_url=self.settings.llm_base_url, headers=headers, timeout=120) as client:
            async with client.stream("POST", "/chat/completions", json=payload) as response:
                if response.status_code >= 400:
                    body = (await response.aread())[:300]
                    raise RuntimeError(f"LLM provider error {response.status_code}: {body!r}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    if not chunk.get("choices"):
                        continue
                    delta = chunk["choices"][0].get("delta") or {}
                    if delta.get("content"):
                        yield {"type": "token", "text": delta["content"]}
                    for call in delta.get("tool_calls") or []:
                        slot = calls.setdefault(call.get("index", 0), {"id": "", "name": "", "arguments": ""})
                        slot["id"] = call.get("id") or slot["id"]
                        function = call.get("function") or {}
                        slot["name"] += function.get("name") or ""
                        slot["arguments"] += function.get("arguments") or ""
        if calls:
            yield {"type": "tool_calls", "calls": [calls[index] for index in sorted(calls)]}


def get_llm() -> LLMClient:
    return OpenAICompatibleLLM(get_settings())
