"""Process-wide singletons shared by routers, the MQTT bridge and background tasks."""
from app.iot.engine import TelemetryEngine
from app.iot.hub import hub

engine = TelemetryEngine(hub)
mqtt_bridge = None  # set in main.lifespan when MQTT is configured
