"""Document Validation agent — validates all customer documents of an upload in one call.

After the model call, ``apply_cbs_checks`` enforces the CBS cross-verification rules
deterministically (name / ID / address-similarity threshold), scoped to the fields each
declared document type actually carries.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional, Tuple

from app.agents.assets import Asset
from app.agents.prompts import DOCUMENT_PROMPT
from app.agents.trim import short_list
from app.bedrock import blocks as B
from app.bedrock import pdf as PDF
from app.bedrock.converse import run_converse
from app.schemas import DocumentItemResult, DocumentResult

logger = logging.getLogger("glportal.agents.document")

# Which CBS fields each declared identity document is expected to carry.
EXPECTED_FIELDS: Dict[str, Tuple[str, ...]] = {
    "Aadhaar Card": ("name", "id", "address"),
    "Voter ID": ("name", "id", "address"),
    "Passport": ("name", "id", "address"),
    "Driving Licence": ("name", "id", "address"),
    "PAN Card": ("name", "id"),
    "Gold Purchase Bill": ("name",),
}


def _failed_item(doc_no: int, doc_type: str, reason: str) -> DocumentItemResult:
    return DocumentItemResult(
        doc_no=doc_no, declared_type=doc_type, status="fail", legible=False, complete=False,
        type_matches_declared=False, pages=[], issues=[reason],
    )


def _fallback(docs: List[Tuple[int, str, Asset]], reason: str) -> DocumentResult:
    return DocumentResult(
        overall_status="fail",
        documents=[_failed_item(n, t, f"Validator could not complete: {reason}") for (n, t, _a) in docs],
        issues=[f"Document validation could not complete: {reason}"],
        corrective_actions=["Retry, or re-upload the document(s)."],
    )


MAX_IMAGE_BLOCKS = 20  # Converse accepts at most 20 images per request


def _all_blocks(docs: List[Tuple[int, str, Asset]]) -> List[dict]:
    """Build every document's content blocks, keeping the total image count within the Converse limit."""
    blocks: List[dict] = []
    budget = MAX_IMAGE_BLOCKS
    for doc_no, doc_type, asset in docs:
        doc_blocks = _blocks_for_document(doc_no, doc_type, asset, budget)
        budget -= sum(1 for b in doc_blocks if "image" in b)
        blocks.extend(doc_blocks)
    return blocks


def _blocks_for_document(doc_no: int, doc_type: str, asset: Asset, image_budget: int = MAX_IMAGE_BLOCKS) -> List[dict]:
    """Build Converse content for one document: header text + doc/image block(s)."""
    header = {"text": f"Document doc_no={doc_no}, declared_type='{doc_type}', filename='{asset.filename}':"}

    img_fmt = B.image_format(asset.content_type, asset.filename)
    if img_fmt:
        if image_budget <= 0:
            return [header, {"text": "  (not analysed — image limit for one request reached)"}]
        return [header, B.image_block(asset.data, img_fmt)]

    doc_fmt = B.doc_format(asset.content_type, asset.filename)
    if doc_fmt == "pdf" and PDF.needs_rasterization(asset.data):
        out: List[dict] = [header]
        try:
            pages = PDF.rasterize_pdf(asset.data, max_pages=max(0, image_budget))
            for page_no, png in pages:
                out.append({"text": f"  page {page_no}:"})
                out.append(B.image_block(png, "png"))
            if PDF.page_count(asset.data) > len(pages):
                out.append({"text": f"  (only the first {len(pages)} page(s) could be analysed in this request)"})
            return out
        except Exception:  # noqa: BLE001 — fall through to the whole-document block
            logger.warning("PDF rasterization failed for doc %s; sending whole document", doc_no)

    if doc_fmt:
        return [header, B.document_block(asset.data, doc_fmt, f"{doc_type}_{doc_no}")]

    return [header, {"text": "  (unsupported document format — cannot inspect content)"}]


async def validate_documents(
    docs: List[Tuple[int, str, Asset]],
    cbs: Optional[dict] = None,
) -> DocumentResult:
    """docs: [(doc_no, declared_type, asset)]. cbs: {customer_name, id_number, address}."""
    if not docs:
        return DocumentResult(overall_status="pass", documents=[], issues=[], corrective_actions=[])

    cbs = cbs or {}
    listing = "; ".join(f"doc_no {n} = '{t}'" for (n, t, _a) in docs)
    cbs_line = (
        f"CBS customer record to cross-verify against — name: '{cbs.get('customer_name', '')}', "
        f"id_number: '{cbs.get('id_number', '')}', address: '{cbs.get('address', '')}'. "
        "If a CBS field is blank, judge only on legibility and leave that match false."
    )
    task = f"There are {len(docs)} document(s): {listing}. {cbs_line} Validate each and key results by doc_no."
    try:
        content_blocks = await asyncio.to_thread(_all_blocks, docs)  # CPU work off the event loop
        result = await run_converse(DOCUMENT_PROMPT, task, content_blocks, DocumentResult, max_tokens=3000)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Document agent failed")
        return _fallback(docs, str(exc)[:160])
    return _realign(result, docs)


def _realign(result: DocumentResult, docs: List[Tuple[int, str, Asset]]) -> DocumentResult:
    """Guarantee exactly one result per input document, keyed by the input doc_no.

    Results are keyed by doc_no only when the model echoed exactly the input numbers; any
    other numbering falls back to position. A document with no result becomes a 'fail' entry.
    """
    items = list(result.documents)
    wanted = [n for (n, _t, _a) in docs]
    returned = [it.doc_no for it in items]
    # Key by number only when the model echoed exactly the input numbers; otherwise (0-indexed,
    # renumbered, duplicated) fall back to position so no result lands on the wrong document.
    by_no = {it.doc_no: it for it in items} if sorted(returned) == sorted(wanted) and len(set(returned)) == len(returned) else None
    aligned = []
    for i, (doc_no, doc_type, _asset) in enumerate(docs):
        it = by_no.get(doc_no) if by_no is not None else (items[i] if i < len(items) else None)
        if it is None:
            it = _failed_item(doc_no, doc_type, "No result returned for this document")
        it.doc_no = doc_no
        it.declared_type = doc_type
        it.issues = short_list(it.issues)
        for pg in it.pages:
            pg.issues = short_list(pg.issues)
        aligned.append(it)
    result.documents = aligned
    result.overall_status = _worst([d.status for d in aligned])
    result.issues = short_list(result.issues)
    result.corrective_actions = short_list(result.corrective_actions)
    return result


def _worst(statuses: List[str]) -> str:
    return "fail" if "fail" in statuses else "alert" if "alert" in statuses else "pass"


def apply_cbs_checks(result: DocumentResult, cbs: dict, address_threshold: int) -> DocumentResult:
    """Downgrade 'pass' documents whose applicant details don't match the CBS record."""
    for doc in result.documents:
        if doc.status == "fail":
            continue  # unreadable — detail mismatches would only be noise
        expected = EXPECTED_FIELDS.get(doc.declared_type, ("name",) if doc.extracted.name else ())
        problems: List[str] = []
        if "name" in expected and cbs.get("customer_name") and not doc.matches.name:
            problems.append("Name does not match CBS record")
        if "id" in expected and cbs.get("id_number") and not doc.matches.id:
            problems.append("ID number does not match CBS record")
        if "address" in expected and cbs.get("address") and doc.matches.address_pct < address_threshold:
            problems.append(f"Address match {doc.matches.address_pct}% (min {address_threshold}%)")
        if problems:
            doc.status = "alert"
            doc.issues = short_list([*problems, *doc.issues], max_items=3)
    result.overall_status = _worst([d.status for d in result.documents]) if result.documents else result.overall_status
    return result
