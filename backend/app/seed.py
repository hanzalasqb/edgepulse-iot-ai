"""Creates demo devices on first start (SEED_DEMO_DEVICES=true). All share DEMO_DEVICE_KEY for the simulator."""
import logging
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.iot.engine import hash_key
from app.models import Device

logger = logging.getLogger("edgepulse.seed")
DEMO_DEVICES = [
    ("pump-01", "Cooling Water Pump 1", "pump", "Plant A · Pump house"),
    ("hvac-02", "Rooftop HVAC 2", "hvac", "Building B · Roof"),
    ("cold-room-03", "Cold Room 3", "cold_room", "Warehouse · Bay 3"),
    ("solar-inv-04", "Solar Inverter 4", "solar_inverter", "Roof array · String 4"),
    ("greenhouse-05", "Greenhouse 5", "greenhouse", "R&D Farm · House 5"),
]


def seed_demo_devices(db: Session) -> None:
    if db.scalar(select(Device).limit(1)):
        return
    key = os.environ.get("DEMO_DEVICE_KEY", "demo-device-key")
    for device_id, name, device_type, location in DEMO_DEVICES:
        db.add(Device(id=device_id, name=name, type=device_type, location=location, firmware="1.4.2", api_key_hash=hash_key(key)))
    db.commit()
    logger.info("Seeded %d demo devices (device key from DEMO_DEVICE_KEY)", len(DEMO_DEVICES))
