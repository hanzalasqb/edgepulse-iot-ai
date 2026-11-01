"""Tools the EdgePulse assistant can call. All data comes from the database / telemetry engine."""
import json
from datetime import timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import state
from app.iot.anomaly import ANOMALY_Z
from app.iot.engine import alert_dict, health_score
from app.iot.forecast import time_to_threshold
from app.iot.metrics import metric_spec, specs_as_dict
from app.models import Alert, Device, Reading, utcnow

TOOLS = [
    {"type": "function", "function": {"name": "get_fleet_status", "description": "Status, health score, open alerts and latest readings for every device.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_device_details", "description": "Metric limits, latest values, open alerts and trend forecasts for one device.",
        "parameters": {"type": "object", "properties": {"device_id": {"type": "string"}}, "required": ["device_id"]}}},
    {"type": "function", "function": {"name": "get_metric_stats", "description": "Statistics for one metric over a time window: min/max/mean/std, change, trend per hour, anomaly count and forecast to the critical limit.",
        "parameters": {"type": "object", "properties": {"device_id": {"type": "string"}, "metric": {"type": "string"}, "minutes": {"type": "integer", "default": 60}}, "required": ["device_id", "metric"]}}},
    {"type": "function", "function": {"name": "list_alerts", "description": "List alerts, newest first.",
        "parameters": {"type": "object", "properties": {"status": {"type": "string", "enum": ["active", "open", "acknowledged", "resolved"]}, "device_id": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "propose_command", "description": "Propose a remote command. It is NOT executed: the operator must confirm it in the UI.",
        "parameters": {"type": "object", "properties": {"device_id": {"type": "string"}, "name": {"type": "string", "enum": ["set_relay", "set_interval", "reboot"]},
                       "payload": {"type": "object", "description": "{'on': bool} for set_relay, {'seconds': int} for set_interval"}, "reason": {"type": "string"}},
                       "required": ["device_id", "name", "reason"]}}},
]


def _open_alerts(db: Session, device_id: str | None = None) -> list[Alert]:
    q = select(Alert).where(Alert.status.in_(("open", "acknowledged")))
    if device_id:
        q = q.where(Alert.device_id == device_id)
    return list(db.scalars(q))


def run_tool(db: Session, name: str, args: dict) -> dict:
    try:
        if name == "get_fleet_status":
            return {"devices": [
                {"id": d.id, "name": d.name, "type": d.type, "status": d.status, "health": health_score(d, alerts := _open_alerts(db, d.id)),
                 "open_alerts": [a.message for a in alerts][:5], "latest": {k: f"{v['value']:g} {v['unit']} ({v['level']})" for k, v in state.engine.latest_values(d).items()}}
                for d in db.scalars(select(Device).order_by(Device.id))
            ]}
        if name == "get_device_details":
            device = db.get(Device, args.get("device_id", ""))
            if device is None:
                return {"error": "Device not found"}
            return {"id": device.id, "name": device.name, "type": device.type, "location": device.location, "status": device.status,
                    "relay_on": device.relay_on, "sampling_interval": device.sampling_interval, "limits": specs_as_dict(device.type),
                    "latest": state.engine.latest_values(device), "forecasts": state.engine.forecasts(device),
                    "open_alerts": [alert_dict(a) for a in _open_alerts(db, device.id)]}
        if name == "get_metric_stats":
            device = db.get(Device, args.get("device_id", ""))
            spec = metric_spec(device.type, args.get("metric", "")) if device else None
            if spec is None:
                return {"error": "Unknown device or metric"}
            minutes = int(args.get("minutes") or 60)
            rows = db.execute(select(Reading.ts, Reading.value, Reading.zscore).where(
                Reading.device_id == device.id, Reading.metric == spec.key, Reading.ts >= utcnow() - timedelta(minutes=minutes)).order_by(Reading.ts)).all()
            if not rows:
                return {"error": "No data in this window"}
            values = np.array([r.value for r in rows])
            forecast = time_to_threshold([r.ts for r in rows], values.tolist(), spec.crit_high, "up") if spec.crit_high is not None else None
            return {"device": device.id, "metric": spec.key, "unit": spec.unit, "window_minutes": minutes, "samples": len(rows),
                    "min": round(float(values.min()), 2), "max": round(float(values.max()), 2), "mean": round(float(values.mean()), 2),
                    "std": round(float(values.std()), 2), "first": round(float(values[0]), 2), "last": round(float(values[-1]), 2),
                    "anomalies": sum(1 for r in rows if r.zscore is not None and abs(r.zscore) >= ANOMALY_Z),
                    "limits": {"warn_high": spec.warn_high, "crit_high": spec.crit_high, "warn_low": spec.warn_low, "crit_low": spec.crit_low},
                    "trend": forecast}
        if name == "list_alerts":
            q = select(Alert).order_by(Alert.updated_at.desc()).limit(20)
            status = args.get("status") or "active"
            q = q.where(Alert.status.in_(("open", "acknowledged"))) if status == "active" else q.where(Alert.status == status)
            if args.get("device_id"):
                q = q.where(Alert.device_id == args["device_id"])
            return {"alerts": [alert_dict(a) for a in db.scalars(q)]}
        if name == "propose_command":
            device = db.get(Device, args.get("device_id", ""))
            if device is None:
                return {"error": "Device not found"}
            return {"proposal": {"device_id": device.id, "device_name": device.name, "name": args.get("name"),
                                 "payload": args.get("payload") or {}, "reason": args.get("reason", "")},
                    "requires_confirmation": True}
        return {"error": f"Unknown tool {name}"}
    except (TypeError, ValueError) as exc:
        return {"error": str(exc)}


def summarize(name: str, result: dict) -> str:
    if "error" in result:
        return f"error: {result['error']}"
    if name == "get_fleet_status":
        devices = result["devices"]
        return f"{len(devices)} devices · {sum(d['status'] == 'online' for d in devices)} online · {sum(len(d['open_alerts']) for d in devices)} open alerts"
    if name == "get_device_details":
        return f"{result['name']} · {len(result['open_alerts'])} open alerts"
    if name == "get_metric_stats":
        trend = result.get("trend") or {}
        return f"{result['device']}/{result['metric']}: {result['first']}→{result['last']} {result['unit']}, {result['anomalies']} anomalies, trend {trend.get('slope_per_hour', 0):+g}/h"
    if name == "list_alerts":
        return f"{len(result['alerts'])} alerts"
    if name == "propose_command":
        p = result["proposal"]
        return f"proposed {p['name']} on {p['device_id']} (needs confirmation)"
    return "done"


def to_model(result: dict) -> str:
    return json.dumps(result, default=str)[:8000]
