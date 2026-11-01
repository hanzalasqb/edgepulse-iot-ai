import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import state
from app.core.config import get_settings

router = APIRouter()


@router.websocket("/ws")
async def websocket(ws: WebSocket, token: str = ""):
    """Real-time stream of telemetry, alerts, device status and commands. Auth: ?token=<JWT>."""
    try:
        jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        await ws.close(code=4401)
        return
    await state.engine.hub.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive pings from the client
    except WebSocketDisconnect:
        state.engine.hub.disconnect(ws)
