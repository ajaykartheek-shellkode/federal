"""Crop a sub-region out of an image given a normalized (0-1) bounding box.

The collateral vision call returns a bounding box per detected ornament in 0-1
coordinates (resolution independent). We crop that region — on the EXIF-upright image,
matching what the model saw — to a small PNG that is mapped to an inventory row.
"""

from __future__ import annotations

import io
from typing import Optional

from app.bedrock.imageprep import open_upright


def crop_normalized(data: bytes, box: dict, pad: float = 0.02, max_side: int = 256) -> Optional[bytes]:
    """Return PNG bytes of the cropped region, or None if the crop is invalid.

    box: {x, y, w, h} each in 0..1 relative to image width/height.
    pad: fraction of padding added around the box (clamped to image bounds).
    max_side: longest edge of the returned thumbnail (keeps assets small).
    """
    try:
        img = open_upright(data)
        width, height = img.size

        x = float(box.get("x", 0))
        y = float(box.get("y", 0))
        w = float(box.get("w", 0))
        h = float(box.get("h", 0))
        if w <= 0 or h <= 0:
            return None

        x0, y0 = max(0.0, x - pad), max(0.0, y - pad)
        x1, y1 = min(1.0, x + w + pad), min(1.0, y + h + pad)
        left, top = int(x0 * width), int(y0 * height)
        right, bottom = int(x1 * width), int(y1 * height)
        if right - left < 4 or bottom - top < 4:
            return None

        crop = img.crop((left, top, right, bottom))
        crop.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        crop.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:  # noqa: BLE001 — a bad crop must never break validation
        return None
