import json
from datetime import UTC, datetime, timedelta

from tests.conftest import DEVICE_KEY


def ingest(client, device_id, values, ts=None, headers=DEVICE_KEY):
    body = {"values": values}
    if ts:
        body["ts"] = ts.isoformat()
    return client.post(f"/api/ingest/{device_id}", json=body, headers=headers)


def test_device_auth_and_ingest(client, auth):
    assert ingest(client, "pump-01", {"vibration": 2.0}, headers={"X-Device-Key": "wrong"}).status_code == 401
    r = ingest(client, "pump-01", {"vibration": 2.1, "temperature": 55, "current": 9.5, "unknown_metric": 1})
    assert r.status_code == 200 and sorted(r.json()["accepted"]) == ["current", "temperature", "vibration"]
    devices = {d["id"]: d for d in client.get("/api/devices", headers=auth).json()}
    assert devices["pump-01"]["status"] == "online" and devices["pump-01"]["latest"]["vibration"]["value"] == 2.1
    assert client.get("/api/devices", headers={}).status_code == 401


def test_threshold_alert_lifecycle(client, auth):
    ingest(client, "hvac-02", {"temperature": 31.5})  # above 30 °C critical
    alerts = client.get("/api/alerts", params={"status": "active", "device_id": "hvac-02"}, headers=auth).json()
    alert = next(a for a in alerts if a["kind"] == "threshold")
    assert alert["severity"] == "critical" and "crossed the critical limit" in alert["message"]
    assert client.post(f"/api/alerts/{alert['id']}/ack", headers=auth).json()["status"] == "acknowledged"
    ingest(client, "hvac-02", {"temperature": 21.0})  # back to normal -> auto-resolve
    resolved = client.get("/api/alerts", params={"status": "resolved", "device_id": "hvac-02"}, headers=auth).json()
    assert any(a["id"] == alert["id"] for a in resolved)


def test_anomaly_and_forecast_from_history(client, auth):
    start = datetime.now(UTC) - timedelta(minutes=50)
    for i in range(100):  # steady vibration with a slow upward drift
        ingest(client, "greenhouse-05", {"temperature": 24 + (i % 3) * 0.1, "humidity": 60, "soil_moisture": 45}, ts=start + timedelta(seconds=30 * i))
    r = ingest(client, "greenhouse-05", {"temperature": 31.0, "humidity": 60, "soil_moisture": 45})
    assert "temperature" in r.json()["anomalies"]
    series = client.get("/api/devices/greenhouse-05/telemetry", params={"minutes": 120}, headers=auth).json()["series"]
    assert any(p["anomaly"] for p in series["temperature"])
    scan = client.get("/api/devices/greenhouse-05/anomaly-scan", params={"minutes": 120}, headers=auth).json()
    assert scan["samples"] >= 100 and scan["anomalies"][0]["temperature"] == 31.0


def test_commands_queue_and_ack(client, auth):
    assert client.post("/api/devices/pump-01/commands", json={"name": "set_relay", "payload": {"on": "yes"}}, headers=auth).status_code == 422
    cmd = client.post("/api/devices/pump-01/commands", json={"name": "set_relay", "payload": {"on": False}}, headers=auth).json()
    assert cmd["status"] == "pending"
    pending = client.get("/api/ingest/pump-01/commands", headers=DEVICE_KEY).json()
    assert pending[0]["id"] == cmd["id"] and pending[0]["payload"] == {"on": False}
    acked = client.post(f"/api/ingest/pump-01/commands/{cmd['id']}/ack", json={"ok": True}, headers=DEVICE_KEY).json()
    assert acked["status"] == "acked"
    assert client.get("/api/devices/pump-01", headers=auth).json()["relay_on"] is False


def test_provision_device_returns_key_once(client, auth):
    r = client.post("/api/devices", json={"id": "pump-99", "name": "Spare pump", "type": "pump"}, headers=auth)
    assert r.status_code == 201 and r.json()["api_key"].startswith("ep_")
    assert ingest(client, "pump-99", {"current": 10}, headers={"X-Device-Key": r.json()["api_key"]}).status_code == 200
    assert client.post("/api/devices", json={"id": "pump-99", "name": "Dup", "type": "pump"}, headers=auth).status_code == 409


def test_offline_watchdog(client, auth):
    import asyncio

    from app import state
    from app.core.db import SessionLocal

    ingest(client, "solar-inv-04", {"voltage": 231, "power": 4.2, "temperature": 41})
    with SessionLocal() as db:
        stale = asyncio.run(state.engine.sweep_offline(db, offline_after=30, now=datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)))
    assert "solar-inv-04" in stale
    alerts = client.get("/api/alerts", params={"status": "active", "device_id": "solar-inv-04"}, headers=auth).json()
    assert any(a["kind"] == "offline" for a in alerts)
    ingest(client, "solar-inv-04", {"voltage": 230})
    assert not any(a["kind"] == "offline" for a in client.get("/api/alerts", params={"status": "active", "device_id": "solar-inv-04"}, headers=auth).json())


def test_websocket_receives_telemetry(client, token):
    with client.websocket_connect(f"/ws?token={token}") as ws:
        ingest(client, "cold-room-03", {"temperature": -18.2, "humidity": 70, "current": 12})
        event = json.loads(ws.receive_text())
        assert event["type"] == "telemetry" and event["device_id"] == "cold-room-03"


def test_websocket_rejects_bad_token(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws?token=bad") as ws:
            ws.receive_text()


def _events(raw):
    return [(b.split("\n")[0][7:], json.loads(b.split("\n")[1][6:])) for b in raw.strip().split("\n\n")]


def test_assistant_uses_tools(client, auth, fake_llm):
    with client.stream("POST", "/api/assistant/stream", json={"message": "Which devices need attention?"}, headers=auth) as r:
        events = _events("".join(r.iter_text()))
    names = [e for e, _ in events]
    assert names[:2] == ["tool_call", "tool_result"] and names[-1] == "done"
    assert "devices" in events[1][1]["summary"]
    assert any(m["role"] == "tool" and "pump-01" in m["content"] for m in fake_llm.calls[-1])


def test_assistant_command_requires_confirmation(client, auth):
    with client.stream("POST", "/api/assistant/stream", json={"message": "turn off the relay on pump-01"}, headers=auth) as r:
        events = _events("".join(r.iter_text()))
    proposal = next(d for e, d in events if e == "proposal")
    assert proposal["name"] == "set_relay" and proposal["payload"] == {"on": False}
    # nothing was executed
    assert client.get("/api/devices/pump-01/commands", headers=auth).json() == [] or all(c["issued_by"] != "assistant" for c in client.get("/api/devices/pump-01/commands", headers=auth).json())
