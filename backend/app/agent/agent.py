import json
from collections.abc import AsyncIterator

from app.agent.tools import TOOLS, run_tool, summarize, to_model
from app.core.db import SessionLocal
from app.core.llm import LLMClient

SYSTEM_PROMPT = """You are EdgePulse AI, an assistant for maintenance and reliability engineers monitoring IoT/embedded devices.

- Always use the tools to read real telemetry, alerts and forecasts. Never invent sensor values.
- When diagnosing, combine evidence: limits, anomalies (modified z-score), trends and correlated metrics.
  Example: rising vibration + motor current + temperature on a pump suggests bearing wear, misalignment or cavitation.
- Give a short **Diagnosis**, the **Evidence** (numbers with units) and prioritised **Recommended actions**.
- You may propose remote commands with propose_command, but they only run after the operator confirms in the UI.
- Be concise and practical."""

MAX_TOOL_ROUNDS = 4


async def run_agent(llm: LLMClient, history: list[dict], message: str) -> AsyncIterator[dict]:
    safe_history = [{"role": h["role"], "content": str(h.get("content", ""))[:4000]} for h in history[-10:] if h.get("role") in ("user", "assistant")]
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *safe_history, {"role": "user", "content": message}]
    for round_number in range(MAX_TOOL_ROUNDS + 1):
        calls: list[dict] = []
        async for event in llm.stream(messages, TOOLS if round_number < MAX_TOOL_ROUNDS else None):
            if event["type"] == "token":
                yield event
            elif event["type"] == "tool_calls":
                calls = event["calls"]
        if not calls:
            break
        messages.append({"role": "assistant", "content": "", "tool_calls": [
            {"id": c["id"] or f"call_{i}", "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}} for i, c in enumerate(calls)]})
        for i, call in enumerate(calls):
            try:
                args = json.loads(call["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            yield {"type": "tool_call", "name": call["name"], "args": args}
            with SessionLocal() as db:
                result = run_tool(db, call["name"], args if isinstance(args, dict) else {})
            yield {"type": "tool_result", "name": call["name"], "summary": summarize(call["name"], result)}
            if "proposal" in result:
                yield {"type": "proposal", **result["proposal"]}
            messages.append({"role": "tool", "tool_call_id": call["id"] or f"call_{i}", "content": to_model(result)})
    yield {"type": "done"}
