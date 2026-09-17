"""Dev smoke test: text round-trip + a one-image Converse call returning strict JSON.

Run from the backend/ directory with the venv active:
    ./.venv/bin/python scripts/bedrock_smoke.py
"""

from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.bedrock import blocks as B  # noqa: E402
from app.bedrock.converse import run_converse  # noqa: E402
from app.config import AWS_REGION, BEDROCK_MODEL_ID  # noqa: E402
from app.schemas import CollateralResult  # noqa: E402


def _test_png() -> bytes:
    """A small but processable image (Bedrock rejects sub-few-pixel images)."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (512, 384), (245, 245, 247))
    draw = ImageDraw.Draw(img)
    draw.ellipse((180, 140, 320, 260), outline=(200, 170, 60), width=10)  # a ring-ish shape
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def main() -> int:
    print(f"Model:  {BEDROCK_MODEL_ID}")
    print(f"Region: {AWS_REGION}")
    print("Sending a 512x384 test image through the collateral schema...")
    result = await run_converse(
        "You are a validation agent. Respond with ONLY JSON matching the schema.",
        "There is 1 collateral image at index 0. Validate it.",
        [B.image_block(_test_png(), "png")],
        CollateralResult,
    )
    print("OK — parsed CollateralResult:")
    print(result.model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
