from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import state
from app.core.db import get_db
from app.core.security import get_current_user
from app.models import Command, Device, User
from app.schemas import CommandIn

router = APIRouter(prefix="/api/devices/{device_id}/commands", tags=["commands"])


def validate_command(name: str, payload: dict) -> dict:
    if name == "set_relay":
        if not isinstance(payload.get("on"), bool):
            raise HTTPException(422, "set_relay requires {'on': true|false}")
        return {"on": payload["on"]}
    if name == "set_interval":
        seconds = payload.get("seconds")
        if not isinstance(seconds, int) or not 1 <= seconds <= 3600:
            raise HTTPException(422, "set_interval requires {'seconds': 1-3600}")
        return {"seconds": seconds}
    return {}


def command_dict(c: Command) -> dict:
    return {"id": c.id, "device_id": c.device_id, "name": c.name, "payload": c.payload, "status": c.status,
            "issued_by": c.issued_by, "created_at": c.created_at.isoformat(), "acked_at": c.acked_at.isoformat() if c.acked_at else None}


@router.post("", status_code=201)
async def send_command(device_id: str, body: CommandIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(404, "Device not found")
    payload = validate_command(body.name, body.payload)
    command = Command(device_id=device_id, name=body.name, payload=payload, issued_by=user.email)
    db.add(command)
    # optimistic desired state; the device confirms with an ack
    if body.name == "set_relay":
        device.relay_on = payload["on"]
    elif body.name == "set_interval":
        device.sampling_interval = payload["seconds"]
    db.commit()
    if state.mqtt_bridge and state.mqtt_bridge.publish_command(command):
        command.status = "sent"
        db.commit()
    await state.engine.hub.broadcast({"type": "command", "command": command_dict(command)})
    return command_dict(command)


@router.get("")
def list_commands(device_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.scalars(select(Command).where(Command.device_id == device_id).order_by(Command.id.desc()).limit(20))
    return [command_dict(c) for c in rows]
