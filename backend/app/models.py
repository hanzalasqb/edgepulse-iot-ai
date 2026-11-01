from datetime import UTC, datetime

from sqlalchemy import JSON, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)  # stored as naive UTC for portability (SQLite/Postgres)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # human readable slug, e.g. pump-01
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(40))
    location: Mapped[str] = mapped_column(String(120), default="")
    firmware: Mapped[str] = mapped_column(String(40), default="1.0.0")
    api_key_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="offline")
    last_seen: Mapped[datetime | None] = mapped_column(default=None)
    sampling_interval: Mapped[int] = mapped_column(Integer, default=5)
    relay_on: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Reading(Base):
    __tablename__ = "readings"
    __table_args__ = (Index("ix_readings_device_metric_ts", "device_id", "metric", "ts"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    metric: Mapped[str] = mapped_column(String(40))
    value: Mapped[float] = mapped_column(Float)
    zscore: Mapped[float | None] = mapped_column(Float, default=None)
    ts: Mapped[datetime] = mapped_column(default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    metric: Mapped[str] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(20))  # threshold | anomaly | forecast | offline
    severity: Mapped[str] = mapped_column(String(20))  # critical | warning | info
    message: Mapped[str] = mapped_column(String(400))
    value: Mapped[float | None] = mapped_column(Float, default=None)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | acknowledged | resolved
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class Command(Base):
    __tablename__ = "commands"
    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | sent | acked | failed
    issued_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    acked_at: Mapped[datetime | None] = mapped_column(default=None)
