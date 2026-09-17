"""PDF handling for Converse.

Default path: pass the PDF straight through as a Converse ``document`` block — Bedrock
handles multi-page PDFs server-side. Fallback: if a PDF exceeds Bedrock's document-block
size limit, rasterize each page to PNG (pypdfium2) and return image blocks tagged with
their page number so the document agent can still produce page-level results.
"""

from __future__ import annotations

from typing import List, Tuple

from app.config import MAX_DOC_BYTES


def needs_rasterization(data: bytes) -> bool:
    return len(data) > MAX_DOC_BYTES


def page_count(data: bytes) -> int:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    try:
        return len(pdf)
    finally:
        pdf.close()


def rasterize_pdf(data: bytes, scale: float = 2.0, max_pages: int = 20) -> List[Tuple[int, bytes]]:
    """Return [(page_number, png_bytes)] for up to ``max_pages`` pages. page_number is 1-based."""
    import pypdfium2 as pdfium  # imported lazily; only needed on the fallback path

    pdf = pdfium.PdfDocument(data)
    pages: List[Tuple[int, bytes]] = []
    try:
        for i in range(min(len(pdf), max_pages)):
            page = pdf[i]
            bitmap = page.render(scale=scale)
            pil_image = bitmap.to_pil()
            import io

            buf = io.BytesIO()
            pil_image.save(buf, format="PNG")
            pages.append((i + 1, buf.getvalue()))
    finally:
        pdf.close()
    return pages
