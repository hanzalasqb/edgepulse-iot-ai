"""Device-facing endpoints, authenticated with the per-device API key (X-Device-Key)."""
from datetime import UTC, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import state
from app.core.db import get_db
from app.iot.engine import verify_device_key
from app.models import Command, Device, utcnow
from app.routers.commands import command_dict
from app.schemas import AckIn, IngestIn

router = APIRouter(prefix="/api/ingest/{device_id}", tags=["device ingestion"])


def authenticate_device(device_id: str, x_device_key: str | None = Header(default=None), db: Session = Depends(get_db)) -> Device:
    device = db.get(Device, device_id)
    if device is None or not verify_device_key(device, x_device_key):
        raise HTTPException(401, "Unknown device or invalid device key")
    return device


@router.post("")
async def ingest(body: IngestIn, device: Device = Depends(authenticate_device), db: Session = Depends(get_db)):
    ts = body.ts
    if ts is not None:
        ts = ts.astimezone(UTC).replace(tzinfo=None) if ts.tzinfo else ts
        now = utcnow()
        if not now - timedelta(days=7) <= ts <= now + timedelta(minutes=1):
            raise HTTPException(422, "Timestamp must be within the last 7 days")
    event = await state.engine.ingest(db, device, body.values, ts)
    return {"accepted": list(event["values"]), "levels": event["levels"], "anomalies": event["anomalies"],
            "relay_on": device.relay_on, "sampling_interval": device.sampling_interval}


@router.get("/commands")
def pending_commands(device: Device = Depends(authenticate_device), db: Session = Depends(get_db)):
    """HTTP polling fallback for devices that do not use MQTT."""
    commands = db.scalars(select(Command).where(Command.device_id == device.id, Command.status == "pending").order_by(Command.id)).all()
    for c in commands:
        c.status = "sent"
    db.commit()
    return [command_dict(c) for c in commands]


@router.post("/commands/{command_id}/ack")
async def ack_command(command_id: int, body: AckIn, device: Device = Depends(authenticate_device), db: Session = Depends(get_db)):
    command = db.get(Command, command_id)
    if command is None or command.device_id != device.id:
        raise HTTPException(404, "Command not found")
    command.status, command.acked_at = ("acked" if body.ok else "failed"), utcnow()
    db.commit()
    await state.engine.hub.broadcast({"type": "command", "command": command_dict(command)})
    return command_dict(command)
