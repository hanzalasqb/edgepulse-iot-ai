from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import state
from app.core.db import get_db
from app.core.security import get_current_user
from app.iot.anomaly import ANOMALY_Z, isolation_forest_scan
from app.iot.engine import hash_key, health_score, new_device_key
from app.iot.metrics import DEVICE_TYPES, specs_as_dict
from app.models import Alert, Device, Reading, utcnow
from app.schemas import DeviceCreate

router = APIRouter(prefix="/api", tags=["devices"], dependencies=[Depends(get_current_user)])


def open_alerts_by_device(db: Session) -> dict[str, list[Alert]]:
    out: dict[str, list[Alert]] = {}
    for alert in db.scalars(select(Alert).where(Alert.status.in_(("open", "acknowledged")))):
        out.setdefault(alert.device_id, []).append(alert)
    return out


def device_summary(device: Device, alerts: list[Alert]) -> dict:
    return {
        "id": device.id, "name": device.name, "type": device.type, "type_label": DEVICE_TYPES.get(device.type, {}).get("label", device.type),
        "location": device.location, "firmware": device.firmware, "status": device.status,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "sampling_interval": device.sampling_interval, "relay_on": device.relay_on,
        "health": health_score(device, alerts), "open_alerts": len(alerts),
        "critical_alerts": sum(a.severity == "critical" for a in alerts),
        "latest": state.engine.latest_values(device),
    }


def get_device_or_404(db: Session, device_id: str) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    return device


@router.get("/device-types")
def device_types():
    return {key: {"label": value["label"], "metrics": specs_as_dict(key)} for key, value in DEVICE_TYPES.items()}


@router.get("/fleet/summary")
def fleet_summary(db: Session = Depends(get_db)):
    devices = db.scalars(select(Device)).all()
    alerts = open_alerts_by_device(db)
    since = utcnow() - timedelta(minutes=1)
    per_minute = db.scalar(select(func.count(Reading.id)).where(Reading.ts >= since)) or 0
    healths = [health_score(d, alerts.get(d.id, [])) for d in devices]
    flat = [a for group in alerts.values() for a in group]
    return {
        "devices": len(devices), "online": sum(d.status == "online" for d in devices),
        "open_alerts": len(flat), "critical_alerts": sum(a.severity == "critical" for a in flat),
        "avg_health": round(sum(healths) / len(healths)) if healths else 100, "readings_per_minute": per_minute,
    }


@router.get("/devices")
def list_devices(db: Session = Depends(get_db)):
    alerts = open_alerts_by_device(db)
    return [device_summary(d, alerts.get(d.id, [])) for d in db.scalars(select(Device).order_by(Device.id))]


@router.post("/devices", status_code=status.HTTP_201_CREATED)
def provision_device(body: DeviceCreate, db: Session = Depends(get_db)):
    if body.type not in DEVICE_TYPES:
        raise HTTPException(422, f"Unknown device type. Options: {', '.join(DEVICE_TYPES)}")
    if db.get(Device, body.id):
        raise HTTPException(409, "Device id already exists")
    key = new_device_key()
    device = Device(id=body.id, name=body.name, type=body.type, location=body.location, api_key_hash=hash_key(key))
    db.add(device)
    db.commit()
    return {"device": device_summary(device, []), "api_key": key, "note": "Store this key on the device now; it is not shown again."}


@router.get("/devices/{device_id}")
def get_device(device_id: str, db: Session = Depends(get_db)):
    device = get_device_or_404(db, device_id)
    alerts = open_alerts_by_device(db).get(device.id, [])
    return {**device_summary(device, alerts), "metrics": specs_as_dict(device.type), "forecasts": state.engine.forecasts(device)}


@router.get("/devices/{device_id}/telemetry")
def telemetry(device_id: str, minutes: int = Query(60, ge=1, le=10080), max_points: int = Query(400, ge=10, le=2000), db: Session = Depends(get_db)):
    get_device_or_404(db, device_id)
    since = utcnow() - timedelta(minutes=minutes)
    rows = db.execute(
        select(Reading.metric, Reading.ts, Reading.value, Reading.zscore)
        .where(Reading.device_id == device_id, Reading.ts >= since).order_by(Reading.ts)
    ).all()
    series: dict[str, list[dict]] = {}
    for metric, ts, value, z in rows:
        series.setdefault(metric, []).append({"ts": ts.isoformat(), "value": round(value, 3), "anomaly": z is not None and abs(z) >= ANOMALY_Z})
    for metric, points in series.items():
        if len(points) > max_points:  # keep anomalies, thin out the rest evenly
            step = len(points) / max_points
            keep = {int(i * step) for i in range(max_points)}
            series[metric] = [p for i, p in enumerate(points) if i in keep or p["anomaly"]]
    return {"device_id": device_id, "minutes": minutes, "series": series}


@router.get("/devices/{device_id}/anomaly-scan")
def anomaly_scan(device_id: str, minutes: int = Query(120, ge=10, le=10080), db: Session = Depends(get_db)):
    """Multivariate Isolation Forest over readings grouped by timestamp."""
    device = get_device_or_404(db, device_id)
    metrics = [m["key"] for m in specs_as_dict(device.type)]
    rows: dict = {}
    for metric, ts, value in db.execute(
        select(Reading.metric, Reading.ts, Reading.value).where(Reading.device_id == device_id, Reading.ts >= utcnow() - timedelta(minutes=minutes))
    ):
        rows.setdefault(ts, {"ts": ts})[metric] = value
    anomalies = isolation_forest_scan(list(rows.values()), metrics)
    return {"device_id": device_id, "samples": len(rows), "metrics": metrics, "anomalies": [{**a, "ts": a["ts"].isoformat()} for a in anomalies[:25]]}
