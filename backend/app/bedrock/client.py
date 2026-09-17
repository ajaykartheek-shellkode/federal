"""Shared boto3 bedrock-runtime client (module singleton, reused across requests)."""

from __future__ import annotations

import threading

import boto3
from botocore.config import Config

from app.config import AWS_REGION

# Retries/timeouts tuned for interactive multimodal calls. Adaptive mode adds client-side
# throttling backoff on top of the agent-level parse retry in converse.py.
_boto_config = Config(
    region_name=AWS_REGION,
    retries={"max_attempts": 3, "mode": "adaptive"},
    read_timeout=90,
    connect_timeout=10,
    max_pool_connections=32,
)

_client = None
_lock = threading.Lock()


def get_client():
    """Lazily create the client; boto3 client creation is not thread-safe, so guard it."""
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = boto3.client("bedrock-runtime", config=_boto_config)
    return _client
