"""Optional MQTT bridge: devices publish to <prefix>/<device_id>/telemetry and receive <prefix>/<device_id>/cmd."""
import asyncio
import json
import logging
from datetime import UTC, datetime

from app.core.config import Settings
from app.core.db import SessionLocal
from app.models import Command, Device

logger = logging.getLogger("edgepulse.mqtt")


class MqttBridge:
    def __init__(self, settings: Settings, engine):
        self.settings, self.engine = settings, engine
        self.client = None
        self.loop: asyncio.AbstractEventLoop | None = None

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        import paho.mqtt.client as mqtt

        self.loop = loop
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="edgepulse-backend")
        if self.settings.mqtt_username:
            client.username_pw_set(self.settings.mqtt_username, self.settings.mqtt_password)
        client.on_connect = self._on_connect
        client.on_message = self._on_message
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        client.connect_async(self.settings.mqtt_host, self.settings.mqtt_port, keepalive=30)
        client.loop_start()
        self.client = client
        logger.info("MQTT bridge connecting to %s:%s", self.settings.mqtt_host, self.settings.mqtt_port)

    def stop(self) -> None:
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        prefix = self.settings.mqtt_topic_prefix
        client.subscribe([(f"{prefix}/+/telemetry", 1), (f"{prefix}/+/ack", 1)])
        logger.info("MQTT connected (%s)", reason_code)

    def _on_message(self, client, userdata, msg):
        if self.loop:
            asyncio.run_coroutine_threadsafe(self.handle(msg.topic, msg.payload), self.loop)

    async def handle(self, topic: str, payload: bytes) -> None:
        from app.iot.engine import verify_device_key

        try:
            _, device_id, kind = topic.split("/", 2)
            data = json.loads(payload)
        except (ValueError, json.JSONDecodeError):
            logger.warning("Ignoring malformed MQTT message on %s", topic)
            return
        with SessionLocal() as db:
            device = db.get(Device, device_id)
            if device is None or not verify_device_key(device, data.get("key")):
                logger.warning("Rejected MQTT message for %s: unknown device or bad key", device_id)
                return
            if kind == "telemetry" and isinstance(data.get("values"), dict):
                await self.engine.ingest(db, device, data["values"])
            elif kind == "ack" and (command := db.get(Command, data.get("command_id"))) is not None:
                command.status = "acked" if data.get("ok", True) else "failed"
                command.acked_at = datetime.now(UTC).replace(tzinfo=None)
                db.commit()

    def publish_command(self, command: Command) -> bool:
        if not self.client or not self.client.is_connected():
            return False
        topic = f"{self.settings.mqtt_topic_prefix}/{command.device_id}/cmd"
        info = self.client.publish(topic, json.dumps({"command_id": command.id, "name": command.name, "payload": command.payload}), qos=1)
        return info.rc == 0
