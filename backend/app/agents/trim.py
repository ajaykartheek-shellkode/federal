"""Safety caps so validation text stays short even if the model over-produces.

The prompts already ask for brevity; these functions enforce hard limits as a backstop
so the UI badges/tooltips never show walls of text.
"""

from __future__ import annotations

from typing import List, Optional


def short(text: Optional[str], max_words: int = 14) -> str:
    if not text:
        return ""
    words = text.strip().split()
    if len(words) <= max_words:
        return text.strip()
    return " ".join(words[:max_words]).rstrip(",.;:") + "…"


def short_list(items: Optional[List[str]], max_items: int = 2, max_words: int = 12) -> List[str]:
    if not items:
        return []
    out: List[str] = []
    for it in items:
        s = short(it, max_words)
        if s and s not in out:
            out.append(s)
        if len(out) >= max_items:
            break
    return out
