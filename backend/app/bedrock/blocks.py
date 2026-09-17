"""Builders for Converse content blocks (image / document) from raw upload bytes."""

from __future__ import annotations

import re
from typing import Optional

from app.bedrock.imageprep import prepare

# Image formats Converse accepts.
_IMAGE_FORMATS = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}

# Document formats Converse accepts.
_DOC_FORMATS = {
    "application/pdf": "pdf",
    "text/csv": "csv",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/html": "html",
    "text/plain": "txt",
    "text/markdown": "md",
}

_NAME_SANITIZE = re.compile(r"[^A-Za-z0-9\-_ ]+")


def image_format(content_type: str, filename: str = "") -> Optional[str]:
    fmt = _IMAGE_FORMATS.get((content_type or "").lower())
    if fmt:
        return fmt
    lower = (filename or "").lower()
    if lower.endswith((".jpg", ".jpeg")):
        return "jpeg"
    if lower.endswith(".png"):
        return "png"
    if lower.endswith(".webp"):
        return "webp"
    if lower.endswith(".gif"):
        return "gif"
    return None


def doc_format(content_type: str, filename: str = "") -> Optional[str]:
    fmt = _DOC_FORMATS.get((content_type or "").lower())
    if fmt:
        return fmt
    lower = (filename or "").lower()
    for ext in ("pdf", "csv", "docx", "doc", "xlsx", "xls", "html", "txt", "md"):
        if lower.endswith("." + ext):
            return ext
    return None


def sanitize_doc_name(name: str, fallback: str = "document") -> str:
    """Bedrock rejects document names with characters outside [A-Za-z0-9-_ ]."""
    cleaned = _NAME_SANITIZE.sub(" ", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:200] or fallback


def image_block(data: bytes, fmt: str) -> dict:
    """Downscale/recompress so large uploads never exceed Bedrock's image limits."""
    safe, safe_fmt = prepare(data, fmt)
    return {"image": {"format": safe_fmt, "source": {"bytes": safe}}}


def document_block(data: bytes, fmt: str, name: str) -> dict:
    return {"document": {"format": fmt, "name": sanitize_doc_name(name), "source": {"bytes": data}}}
