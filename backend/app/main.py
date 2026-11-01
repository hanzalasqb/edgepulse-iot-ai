import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import state
from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.routers import alerts, assistant, auth, commands, devices, ingest, ws
from app.seed import seed_demo_devices

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


async def offline_watchdog(interval: float = 10.0):
    settings = get_settings()
    while True:
        await asyncio.sleep(interval)
        with SessionLocal() as db:
            await state.engine.sweep_offline(db, settings.offline_after_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    init_db()
    with SessionLocal() as db:
        if settings.seed_demo_devices:
            seed_demo_devices(db)
        state.engine.warm_up(db)
    if settings.mqtt_host:
        from app.iot.mqtt_bridge import MqttBridge

        state.mqtt_bridge = MqttBridge(settings, state.engine)
        state.mqtt_bridge.start(asyncio.get_running_loop())
    watchdog = asyncio.create_task(offline_watchdog())
    yield
    watchdog.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await watchdog
    if state.mqtt_bridge:
        state.mqtt_bridge.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="EdgePulse IoT AI", version="1.0.0", lifespan=lifespan,
                  description="Real-time IoT telemetry, anomaly detection, predictive maintenance and an AI assistant for embedded devices.")
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    for router in (auth.router, devices.router, alerts.router, commands.router, ingest.router, assistant.router, ws.router):
        app.include_router(router)

    @app.get("/api/health", tags=["health"])
    def health():
        return {"status": "ok", "mqtt": bool(state.mqtt_bridge)}

    return app


app = create_app()
