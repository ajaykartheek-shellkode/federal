"""Normalise images before they are sent to Bedrock or cropped.

Bedrock rejects images over ~5 MB and very large dimensions; Claude also processes at
≈1568 px on the long edge, so anything bigger is wasted bytes. ``prepare`` applies the
EXIF orientation (so the model sees exactly what the browser shows), shrinks the longest
side and re-encodes as JPEG until the payload is comfortably under the limit.
"""

from __future__ import annotations

import io
from typing import Optional, Tuple

MAX_SIDE = 1568
MAX_BYTES = 3_800_000


def open_upright(data: bytes):
    """Open image bytes with EXIF orientation applied, converted to RGB. Raises on bad data."""
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def prepare(data: bytes, original_fmt: Optional[str] = None) -> Tuple[bytes, str]:
    """Return ``(bytes, format)`` safe for a Converse image block.

    On success the image is JPEG. If Pillow cannot decode the bytes, the original bytes are
    returned together with their original format so the block stays self-consistent.
    """
    try:
        img = open_upright(data)
        w, h = img.size
        longest = max(w, h)
        if longest > MAX_SIDE:
            scale = MAX_SIDE / longest
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))))

        quality = 90
        out = _encode_jpeg(img, quality)
        while len(out) > MAX_BYTES and quality > 40:
            quality -= 15
            out = _encode_jpeg(img, quality)
        return out, "jpeg"
    except Exception:  # noqa: BLE001 — never block validation on a prep error
        return data, (original_fmt or "jpeg")


def thumbnail(data: bytes, max_side: int = 320) -> Optional[bytes]:
    """Small upright JPEG preview of an image, or None if it cannot be decoded."""
    try:
        img = open_upright(data)
        img.thumbnail((max_side, max_side))
        return _encode_jpeg(img, 85)
    except Exception:  # noqa: BLE001
        return None


def _encode_jpeg(img, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()
