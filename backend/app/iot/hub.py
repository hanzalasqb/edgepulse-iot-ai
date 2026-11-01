import asyncio
import json
import logging

from fastapi import WebSocket

logger = logging.getLogger("edgepulse.ws")


class Hub:
    """Fan-out of real-time events to connected dashboards (swap for Redis pub/sub when scaling out)."""

    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, event: dict):
        if not self.clients:
            return
        message = json.dumps(event, default=str)
        results = await asyncio.gather(*(c.send_text(message) for c in list(self.clients)), return_exceptions=True)
        for client, result in zip(list(self.clients), results):
            if isinstance(result, Exception):
                self.disconnect(client)


hub = Hub()
