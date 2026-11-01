"""Telemetry pipeline: persist -> detect (limits, anomalies, trends) -> manage alerts -> broadcast."""
import hashlib
import hmac
import secrets
from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.iot.anomaly import RobustZScore
from app.iot.forecast import time_to_threshold
from app.iot.hub import Hub
from app.iot.metrics import DEVICE_TYPES, metric_spec
from app.models import Alert, Device, Reading, utcnow

FORECAST_EVERY = 10
FORECAST_HORIZON_HOURS = 6.0
SEVERITY_PENALTY = {"critical": 35, "warning": 12, "info": 4}


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_device_key() -> str:
    return "ep_" + secrets.token_urlsafe(24)


def verify_device_key(device: Device, key: str | None) -> bool:
    return bool(key) and hmac.compare_digest(device.api_key_hash, hash_key(key))


def format_hours(hours: float) -> str:
    return f"{hours * 60:.0f} min" if hours < 1 else f"{hours:.1f} h"


def health_score(device: Device, open_alerts: list[Alert]) -> int:
    if device.status == "offline":
        return 0
    return max(0, 100 - sum(SEVERITY_PENALTY.get(a.severity, 0) for a in open_alerts))


class TelemetryEngine:
    def __init__(self, hub: Hub):
        self.hub = hub
        self.detectors: dict[tuple[str, str], RobustZScore] = {}
        self.latest: dict[tuple[str, str], tuple[float, datetime, str]] = {}
        self.samples: Counter[tuple[str, str]] = Counter()

    def detector(self, device_id: str, metric: str) -> RobustZScore:
        return self.detectors.setdefault((device_id, metric), RobustZScore())

    def warm_up(self, db: Session) -> None:
        """Rebuild detector windows from the database after a restart."""
        for device in db.scalars(select(Device)):
            for spec in DEVICE_TYPES.get(device.type, {}).get("metrics", []):
                rows = db.scalars(
                    select(Reading).where(Reading.device_id == device.id, Reading.metric == spec.key)
                    .order_by(Reading.ts.desc()).limit(120)
                ).all()
                det = self.detector(device.id, spec.key)
                for r in reversed(rows):
                    det.update(r.value, r.ts)
                if rows:
                    self.latest[(device.id, spec.key)] = (rows[0].value, rows[0].ts, spec.level(rows[0].value))

    def latest_values(self, device: Device) -> dict:
        out = {}
        for spec in DEVICE_TYPES.get(device.type, {}).get("metrics", []):
            if (item := self.latest.get((device.id, spec.key))) is not None:
                out[spec.key] = {"value": item[0], "ts": item[1].isoformat(), "level": item[2], "unit": spec.unit, "label": spec.label}
        return out

    def forecasts(self, device: Device) -> dict:
        out = {}
        for spec in DEVICE_TYPES.get(device.type, {}).get("metrics", []):
            det = self.detectors.get((device.id, spec.key))
            if det and spec.crit_high is not None:
                fc = time_to_threshold(list(det.times), list(det.values), spec.crit_high, "up")
                if fc:
                    out[spec.key] = fc
        return out

    @staticmethod
    def _open_alert(db: Session, device_id: str, metric: str, kind: str) -> Alert | None:
        return db.scalar(select(Alert).where(
            Alert.device_id == device_id, Alert.metric == metric, Alert.kind == kind, Alert.status.in_(("open", "acknowledged"))
        ))

    def _raise(self, db: Session, changed: list[Alert], device_id: str, metric: str, kind: str, severity: str, message: str, value: float | None):
        alert = self._open_alert(db, device_id, metric, kind)
        now = utcnow()
        if alert is None:
            alert = Alert(device_id=device_id, metric=metric, kind=kind, severity=severity, message=message, value=value, created_at=now, updated_at=now)
            db.add(alert)
            changed.append(alert)
        else:
            escalated = alert.severity != "critical" and severity == "critical"
            alert.severity = "critical" if escalated or alert.severity == "critical" else severity
            alert.message, alert.value, alert.updated_at = message, value, now
            if escalated:
                alert.status = "open"
                changed.append(alert)

    def _resolve(self, db: Session, changed: list[Alert], device_id: str, metric: str, kind: str):
        if alert := self._open_alert(db, device_id, metric, kind):
            alert.status, alert.updated_at = "resolved", utcnow()
            changed.append(alert)

    async def ingest(self, db: Session, device: Device, values: dict[str, float], ts: datetime | None = None) -> dict:
        ts = ts or utcnow()
        changed: list[Alert] = []
        levels, anomalies, accepted = {}, {}, {}
        for metric, raw in values.items():
            spec = metric_spec(device.type, metric)
            if spec is None:
                continue
            value = float(raw)
            det = self.detector(device.id, metric)
            z, is_anomaly = det.update(value, ts)
            db.add(Reading(device_id=device.id, metric=metric, value=value, zscore=round(z, 3) if z is not None else None, ts=ts))
            level = spec.level(value)
            levels[metric], accepted[metric] = level, value
            self.latest[(device.id, metric)] = (value, ts, level)

            if level == "normal":
                self._resolve(db, changed, device.id, metric, "threshold")
            else:
                limit = spec.crit_high if level == "critical" and spec.crit_high is not None and value >= spec.crit_high else spec.crit_low if level == "critical" else spec.warn_high if spec.warn_high is not None and value >= spec.warn_high else spec.warn_low
                self._raise(db, changed, device.id, metric, "threshold", level,
                            f"{spec.label} at {value:g} {spec.unit} crossed the {level} limit ({limit:g} {spec.unit})", value)
            if is_anomaly:
                anomalies[metric] = round(z, 2)
                self._raise(db, changed, device.id, metric, "anomaly", "warning",
                            f"Unusual {spec.label.lower()}: {value:g} {spec.unit} vs baseline {det.baseline():.1f} {spec.unit} (z = {z:.1f})", value)

            self.samples[(device.id, metric)] += 1
            if self.samples[(device.id, metric)] % FORECAST_EVERY == 0 and spec.crit_high is not None and level != "critical":
                fc = time_to_threshold(list(det.times), list(det.values), spec.crit_high, "up")
                if fc and fc["hours_to_threshold"] is not None and fc["hours_to_threshold"] <= FORECAST_HORIZON_HOURS and fc["r2"] >= 0.5:
                    self._raise(db, changed, device.id, metric, "forecast", "warning",
                                f"{spec.label} rising {fc['slope_per_hour']:+.2f} {spec.unit}/h — predicted to reach {spec.crit_high:g} {spec.unit} in ~{format_hours(fc['hours_to_threshold'])}", value)
                elif fc and fc["hours_to_threshold"] is None:
                    self._resolve(db, changed, device.id, metric, "forecast")

        was_offline = device.status != "online"
        device.last_seen, device.status = ts, "online"
        if was_offline:
            self._resolve(db, changed, device.id, "connectivity", "offline")
        db.commit()
        event = {"type": "telemetry", "device_id": device.id, "ts": ts.isoformat(), "values": accepted, "levels": levels, "anomalies": anomalies}
        await self.hub.broadcast(event)
        for alert in changed:
            await self.hub.broadcast({"type": "alert", "alert": alert_dict(alert)})
        if was_offline:
            await self.hub.broadcast({"type": "device_status", "device_id": device.id, "status": "online"})
        return event

    async def sweep_offline(self, db: Session, offline_after: int, now: datetime | None = None) -> list[str]:
        now = now or utcnow()
        cutoff = now - timedelta(seconds=offline_after)
        stale = db.scalars(select(Device).where(Device.status == "online", Device.last_seen < cutoff)).all()
        changed: list[Alert] = []
        for device in stale:
            device.status = "offline"
            self._raise(db, changed, device.id, "connectivity", "offline", "critical",
                        f"{device.name} stopped reporting (last seen {device.last_seen:%H:%M:%S} UTC)", None)
        db.commit()
        for device in stale:
            await self.hub.broadcast({"type": "device_status", "device_id": device.id, "status": "offline"})
        for alert in changed:
            await self.hub.broadcast({"type": "alert", "alert": alert_dict(alert)})
        return [d.id for d in stale]


def alert_dict(a: Alert) -> dict:
    return {
        "id": a.id, "device_id": a.device_id, "metric": a.metric, "kind": a.kind, "severity": a.severity,
        "message": a.message, "value": a.value, "status": a.status,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
