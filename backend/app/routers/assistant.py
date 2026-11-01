import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.agent.agent import run_agent
from app.core.config import get_settings
from app.core.llm import LLMClient, get_llm
from app.core.ratelimit import RateLimiter
from app.core.security import get_current_user
from app.schemas import AssistantIn

router = APIRouter(prefix="/api/assistant", tags=["assistant"])
logger = logging.getLogger("edgepulse.assistant")
limiter = RateLimiter(get_settings().assistant_rate_limit_per_minute)


@router.post("/stream")
async def stream(body: AssistantIn, _user=Depends(get_current_user), llm: LLMClient = Depends(get_llm), _rl: None = Depends(limiter)):
    async def events():
        try:
            async for event in run_agent(llm, body.history, body.message):
                yield f"event: {event['type']}\ndata: {json.dumps(event, default=str)}\n\n"
        except Exception:
            logger.exception("assistant failed")
            yield f"event: error\ndata: {json.dumps({'message': 'The AI provider returned an error. Check LLM settings.'})}\n\n"
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
