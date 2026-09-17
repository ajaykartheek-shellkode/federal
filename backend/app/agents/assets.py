"""In-memory representation of an uploaded file, shared across agents."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Asset:
    data: bytes
    filename: str
    content_type: str
