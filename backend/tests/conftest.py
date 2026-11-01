import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["JWT_SECRET"] = "test-secret-with-at-least-32-bytes-of-entropy"
os.environ["MQTT_HOST"] = ""
os.environ["SEED_DEMO_DEVICES"] = "true"
os.environ["DEMO_DEVICE_KEY"] = "test-device-key"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.llm import get_llm  # noqa: E402
from app.main import app  # noqa: E402

DEVICE_KEY = {"X-Device-Key": "test-device-key"}


class FakeLLM:
    """Calls get_fleet_status (and propose_command when asked), then answers."""

    def __init__(self):
        self.calls = []

    async def stream(self, messages, tools=None):
        self.calls.append(messages)
        user = messages[-1]["content"] if messages[-1]["role"] == "user" else next(m["content"] for m in reversed(messages) if m["role"] == "user")
        done_tools = [m for m in messages if m["role"] == "tool"]
        if tools and not done_tools:
            if "relay" in user:
                args = '{"device_id": "pump-01", "name": "set_relay", "payload": {"on": false}, "reason": "Vibration critical"}'
                yield {"type": "tool_calls", "calls": [{"id": "c1", "name": "propose_command", "arguments": args}]}
            else:
                yield {"type": "tool_calls", "calls": [{"id": "c1", "name": "get_fleet_status", "arguments": "{}"}]}
            return
        yield {"type": "token", "text": "**Diagnosis**: pump-01 needs attention."}


@pytest.fixture
def fake_llm():
    return FakeLLM()


@pytest.fixture
def client(fake_llm):
    app.dependency_overrides[get_llm] = lambda: fake_llm
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def token(client):
    import uuid

    r = client.post("/api/auth/register", json={"email": f"eng-{uuid.uuid4().hex[:6]}@example.com", "name": "Reliability Eng", "password": "s3cure-pass!"})
    return r.json()["access_token"]


@pytest.fixture
def auth(token):
    return {"Authorization": f"Bearer {token}"}
