"""Core Bedrock Converse caller: prompt + content blocks -> validated Pydantic model.

Responsibilities:
  * build and issue the Converse request (boto3, synchronous, run in a worker thread)
  * extract the assistant text and decode the first JSON object in it
  * validate against the agent's Pydantic model
  * retry once with a "return only JSON" nudge on parse/validation failure

Transport errors (throttling, auth, timeouts) propagate so each agent can fall back to
a structured "could not complete" result.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import List, Optional, Type, TypeVar

from pydantic import BaseModel, ValidationError

from app.bedrock.client import get_client
from app.config import BEDROCK_MODEL_ID

logger = logging.getLogger("glportal.bedrock")

T = TypeVar("T", bound=BaseModel)

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_DECODER = json.JSONDecoder()


def extract_json(text: str) -> object:
    """Decode the first JSON object in the model text (tolerates fences and trailing prose)."""
    cleaned = _FENCE_RE.sub("", (text or "").strip()).strip()
    start = cleaned.find("{")
    if start == -1:
        raise json.JSONDecodeError("No JSON object found", cleaned, 0)
    obj, _end = _DECODER.raw_decode(cleaned, start)
    return obj


def _schema_hint(model: Type[BaseModel]) -> str:
    return json.dumps(model.model_json_schema(), separators=(",", ":"))


def _call_bedrock(system_prompt: str, content: List[dict], max_tokens: int) -> str:
    resp = get_client().converse(
        modelId=BEDROCK_MODEL_ID,
        system=[{"text": system_prompt}],
        messages=[{"role": "user", "content": content}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0},
    )
    parts = resp.get("output", {}).get("message", {}).get("content", [])
    return "".join(part.get("text", "") for part in parts if "text" in part)


def _sync_run(system_prompt: str, task_text: str, blocks: List[dict], model: Type[T], max_tokens: int) -> T:
    instruction = (
        f"{task_text}\n\n"
        "Respond with ONLY a single JSON object — no prose, no markdown fences — "
        f"that validates against this JSON schema:\n{_schema_hint(model)}"
    )
    last_error: Optional[str] = None
    for attempt in range(2):
        text = instruction
        if attempt == 1 and last_error:
            text += f"\n\nYour previous reply was invalid ({last_error}). Return ONLY the JSON object."
        try:
            raw = _call_bedrock(system_prompt, [{"text": text}, *blocks], max_tokens)
            return model.model_validate(extract_json(raw))
        except (json.JSONDecodeError, ValidationError) as exc:
            last_error = str(exc)[:200]
            logger.warning("Converse parse failure (attempt %d): %s", attempt + 1, last_error)

    raise ValueError(f"Model output did not validate after retry: {last_error}")


async def run_converse(
    system_prompt: str,
    task_text: str,
    blocks: List[dict],
    model: Type[T],
    max_tokens: int = 2000,
) -> T:
    """Async wrapper — boto3 is synchronous, so run it in a worker thread."""
    return await asyncio.to_thread(_sync_run, system_prompt, task_text, blocks, model, max_tokens)
