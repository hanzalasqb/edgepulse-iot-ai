from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import state
from app.core.db import get_db
from app.core.security import get_current_user
from app.iot.engine import alert_dict
from app.models import Alert, utcnow

router = APIRouter(prefix="/api/alerts", tags=["alerts"], dependencies=[Depends(get_current_user)])


@router.get("")
def list_alerts(status: str | None = Query(None, pattern="^(open|acknowledged|resolved|active)$"), device_id: str | None = None,
                limit: int = Query(100, le=500), db: Session = Depends(get_db)):
    query = select(Alert).order_by(Alert.updated_at.desc()).limit(limit)
    if status == "active":
        query = query.where(Alert.status.in_(("open", "acknowledged")))
    elif status:
        query = query.where(Alert.status == status)
    if device_id:
        query = query.where(Alert.device_id == device_id)
    return [alert_dict(a) for a in db.scalars(query)]


async def _set_status(alert_id: int, new_status: str, db: Session):
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, "Alert not found")
    alert.status, alert.updated_at = new_status, utcnow()
    db.commit()
    await state.engine.hub.broadcast({"type": "alert", "alert": alert_dict(alert)})
    return alert_dict(alert)


@router.post("/{alert_id}/ack")
async def acknowledge(alert_id: int, db: Session = Depends(get_db)):
    return await _set_status(alert_id, "acknowledged", db)


@router.post("/{alert_id}/resolve")
async def resolve(alert_id: int, db: Session = Depends(get_db)):
    return await _set_status(alert_id, "resolved", db)
