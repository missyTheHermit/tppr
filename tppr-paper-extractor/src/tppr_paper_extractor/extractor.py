"""Convert Mistral OCR output into tppr paper JSON.

The input is the JSON document shape produced by Mistral's OCR API
(``{"pages": [{"markdown", "images", "tables", ...}, ...]}``). The output is a
"tppr paper document": paper metadata plus a list of questions whose content is
expressed with the same content-block / option / part vocabulary the backend
uses (see ``backend/src/questions/types.py``).

The extractor is intentionally standalone: it depends only on the Python
standard library so it can run as a script anywhere and be wired into the
backend later without dragging in SQLAlchemy/SQLModel.

Parsing is heuristic. HSC papers follow a small set of conventions but Mistral
emits several variants (``(A)`` vs ``A.`` vs ``- A.`` options; ``a)`` vs ``(a)``
parts; ``**1**`` vs ``1.`` numbering). This module handles the variants seen in
the bundled samples; odd pages may need manual touch-up.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

# ---------------------------------------------------------------------------
# Regex vocabulary
# ---------------------------------------------------------------------------

# Page artefacts: "2 | Page", "– 2 –", "- 3 -", bare page numbers, "1140".
_PAGE_MARKER_RE = re.compile(r"^\s*(?:[–\-|]\s*)?\d{1,4}\s*(?:[–\-|]\s*)?\s*$")
# A markdown image: ![alt](id)
_IMAGE_MD_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
# A markdown link in general (catches table refs like [tbl-0.html](tbl-0.html)).
_LINK_MD_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

# Question header: "Question 21 (4 marks)" / "**Question 11** (15 marks)" / "QUESTION 11 (15 marks)."
_QUESTION_HEADER_RE = re.compile(
    r"^\s*\**\s*[Qq]uestion\s+(\d{1,3})\s*\**\s*(?:\((\d+)\s*marks?\))?",
    re.IGNORECASE,
)
# A numbered MCQ/short question line: "1. ...", "**1** ...", "1 ...".
_QUESTION_NUM_RE = re.compile(r"^\s*\**\s*(\d{1,3})\b[.\):]?\s*\**\s+(.+)$")
# MCQ option line: "(A) ...", "A. ...", "A) ...", "- A. ...", "**A.** ...". A real
# option label is always delimited by "." or ")" (or parens), so a sentence
# starting with "A ..." is NOT mistaken for an option. Body may be empty when
# the option content is an image on following line(s): "A." then "![img](img)".
_OPTION_RE = re.compile(
    r"^\s*(?:[-*]\s+)?\**\s*(?:\(([A-D])\)\.?|([A-D])[.)])\**\s*(.*)$"
)
# Part label with trailing content: "a) ...", "(a) ...", "(i) ...", "1) ..."
_PART_LABEL_RE = re.compile(
    r"^\s*(?:[-*]\s+)?\**\s*(?:\(([a-zA-Z0-9]+)\)|([a-zA-Z]+|[0-9]+)\))\**\s+(.+)$"
)
# Bare part label with no content on the same line: "(a)", "b)", "(ii)"
_PART_LABEL_BARE_RE = re.compile(
    r"^\s*(?:[-*]\s+)?\**\s*(?:\(([a-zA-Z0-9]+)\)|([a-zA-Z]+|[0-9]+)\))\**\s*$"
)
_ROMAN_RE = re.compile(r"^(i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3}|xii)$", re.IGNORECASE)
# Trailing marks on a part line: "... 2", "... (2 marks)", "... 2 marks", or
# "...$$. 2" (period + space + digit). A period with no space (a decimal like
# "1.871") is NOT treated as marks.
_TRAILING_MARKS_RE = re.compile(
    r"\s*(?:\((\d+)\s*marks?\)|(\d+)\s*marks?|\.\s+(\d+)|\s+(\d+))\s*$"
)

_BOILERPLATE_PHRASES = (
    "reading time", "working time", "write using", "calculators approved",
    "calculators may be used", "nesa-approved calculators", "reference sheet",
    "a reference sheet is provided", "data sheet", "periodic table",
    "general instructions", "total marks", "attempt questions", "allow about",
    "use the multiple choice answer sheet", "end of section", "end of question",
    "office use only", "do not write", "do not write in this area",
    "write your centre number", "write your center number",
    "show relevant mathematical reasoning", "nsw government",
    "nsw education standards authority", "[logo]", "higher school certificate",
    "answer each question in the appropriate", "extra sheets of writing",
    "draw diagrams using pencil", "write using black pen",
    "for questions in section ii", "in questions 11", "in questions 1-16",
)
_COURSE_LEVEL_MAP = {
    "mathematics extension 1": "extension_1",
    "mathematics extension 2": "extension_2",
    "mathematics advanced": "advanced",
    "mathematics standard": "standard",
    "physics": None,
    "chemistry": None,
    "biology": None,
}


# ---------------------------------------------------------------------------
# Content blocks (mirror backend/src/questions/types.py)
# ---------------------------------------------------------------------------


def _text_block(text: str) -> dict[str, Any]:
    text = text.strip()
    return {"kind": "text", "text": text} if text else None  # type: ignore[return-value]


def _image_block(image: dict[str, Any]) -> dict[str, Any]:
    block: dict[str, Any] = {"kind": "image", "url": image.get("image_base64") or ""}
    if image.get("image_base64") and not block["url"].startswith("data:"):
        # Mistral already gives a data URL; keep it. (asset:// rewrite happens at
        # backend integration time, not here.)
        pass
    # mime sniff from id
    mid = (image.get("id") or "").lower()
    if mid.endswith(".png"):
        block["mime_type"] = "image/png"
    elif mid.endswith(".jpeg") or mid.endswith(".jpg"):
        block["mime_type"] = "image/jpeg"
    elif image.get("image_base64", "").startswith("data:"):
        block["mime_type"] = image["image_base64"].split(";", 1)[0].replace("data:", "")
    tlx, tly = image.get("top_left_x"), image.get("top_left_y")
    brx, bry = image.get("bottom_right_x"), image.get("bottom_right_y")
    if None not in (tlx, tly, brx, bry):
        block["width"] = max(1, brx - tlx)
        block["height"] = max(1, bry - tly)
    if not block["url"]:
        block["url"] = image.get("id", "")
    return block


def _table_block(html: str) -> dict[str, Any]:
    return {"kind": "table", "html": html}


# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------


def _is_boilerplate(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    low = s.lower().lstrip("#-*").strip()
    low = low.replace("**", "")
    if any(phrase in low for phrase in _BOILERPLATE_PHRASES):
        return True
    if _PAGE_MARKER_RE.match(s):
        return True
    # "2 | Page", "3 Page", trailing page footers
    if re.fullmatch(r"\d+\s*\|?\s*[Pp]age\s*", s):
        return True
    if re.fullmatch(r"[\s.…·-]+", s):
        return True
    # Standalone section mark summary: "10 marks", "**90 marks**"
    if re.fullmatch(r"\**\s*\d+\s*marks?\s*\**", s, re.IGNORECASE):
        return True
    # Structural headings that are not questions: "# Section I ...", "## Section II"
    if low.startswith("section i") or low.startswith("section ii") or low.startswith("section 1") or low.startswith("section 2"):
        return True
    return False

# ---------------------------------------------------------------------------
# Stream assembly
# ---------------------------------------------------------------------------


@dataclass
class _Stream:
    lines: list[str] = field(default_factory=list)
    images: dict[str, dict[str, Any]] = field(default_factory=dict)
    tables: dict[str, str] = field(default_factory=dict)


def _build_stream(doc: dict[str, Any]) -> _Stream:
    stream = _Stream()
    for page in doc.get("pages", []):
        for im in page.get("images", []) or []:
            if im.get("id"):
                stream.images[im["id"]] = im
        for tb in page.get("tables", []) or []:
            if tb.get("id"):
                stream.tables[tb["id"]] = tb.get("content", "")
        md = page.get("markdown", "") or ""
        for line in md.split("\n"):
            stream.lines.append(line)
    return stream


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


def _find_year(lines: list[str]) -> int | None:
    for line in lines[:30]:
        m = re.search(r"\b(20\d{2})\b", line)
        if m:
            return int(m.group(1))
    return None


def _find_subject(lines: list[str]) -> str | None:
    for line in lines[:30]:
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip()
    return None


def _find_school(lines: list[str]) -> str | None:
    for line in lines[:20]:
        s = line.strip().strip("*").strip()
        if not s:
            continue
        low = s.lower()
        if "higher school certificate" in low or "nsw" in low or "examination" in low:
            continue
        if "school" in low or "college" in low or "high" in low:
            return s
    return None


def _find_source(school: str | None, lines: list[str]) -> str:
    if school:
        return "trial"
    for line in lines[:40]:
        if "trial" in line.lower():
            return "trial"
    return "hsc"


def _find_duration(lines: list[str]) -> int | None:
    blob = " ".join(lines[:40]).lower()
    hours = re.search(r"(\d+)\s*hours?(?:\s+and\s+(\d+)\s*minutes?)?", blob)
    minutes = re.search(r"(\d+)\s*minutes?", blob)
    total = 0
    got = False
    if hours:
        total += int(hours.group(1)) * 60
        if hours.group(2):
            total += int(hours.group(2))
        got = True
    if minutes and not got:
        total += int(minutes.group(1))
        got = True
    return total if got else None


def _find_total_marks(lines: list[str]) -> int | None:
    blob = " ".join(lines[:40])
    m = re.search(r"total\s*marks?[^0-9\n]{0,8}(\d+)", blob, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


# ---------------------------------------------------------------------------
# Section + question splitting
# ---------------------------------------------------------------------------


def _line_is_question_header(line: str) -> int | None:
    # Strip markdown heading markers and bold so "# **Question 21** (4 marks)"
    # is recognised as a question header.
    s = line.strip().lstrip("#").strip().strip("*").strip()
    if not s or "continue" in s.lower():
        return None
    m = _QUESTION_HEADER_RE.match(s)
    return int(m.group(1)) if m else None


def _line_is_question_number(line: str) -> tuple[int, str] | None:
    s = line.strip()
    if not s or s.startswith("#"):
        return None
    m = _QUESTION_NUM_RE.match(s)
    if not m:
        return None
    return int(m.group(1)), m.group(2).strip()


# ---------------------------------------------------------------------------
# Content-block conversion for a span of lines
# ---------------------------------------------------------------------------


def _normalize_math(text: str) -> str:
    """Demote inline ``$$...$$`` to ``$...$``.

    Mistral often emits ``$$...$$`` for math that actually sits inline within a
    sentence. The renderer (``frontend/src/components/math-text.tsx``) treats
    ``$$...$$`` as a block (display) equation, which breaks the sentence flow,
    and ``$...$`` as inline. A ``$$...$$`` that is the sole content of its line
    is a real display equation and is kept as ``$$...$$``.
    """
    out = []
    for line in text.split("\n"):
        stripped = line.strip()
        is_display = (
            stripped.startswith("$$")
            and stripped.endswith("$$")
            and stripped.count("$$") == 2
            and len(stripped) > 4
        )
        if is_display:
            out.append(line)
        else:
            out.append(re.sub(r"\$\$(.+?)\$\$", r"$\1$", line))
    return "\n".join(out)


def _convert_line_to_blocks(
    line: str, images: dict[str, dict[str, Any]], tables: dict[str, str]
) -> list[dict[str, Any]]:
    """Turn one source line into text/image/table blocks, preserving math."""
    line = _normalize_math(line)
    blocks: list[dict[str, Any]] = []
    cursor = 0
    combined = list(_IMAGE_MD_RE.finditer(line)) + list(
        e for e in _LINK_MD_RE.finditer(line) if _IMAGE_MD_RE.match(e.group(0)) is None
    )
    combined.sort(key=lambda e: e.start())
    for ev in combined:
        if ev.start() > cursor:
            piece = line[cursor: ev.start()]
            tb = _text_block(piece)
            if tb:
                blocks.append(tb)
        ref = ev.group(2)
        if _IMAGE_MD_RE.match(ev.group(0)):
            img = images.get(ref)
            if img:
                blocks.append(_image_block(img))
            else:
                blocks.append(_text_block(ev.group(0)) or {"kind": "text", "text": ev.group(0)})
        else:
            html = tables.get(ref)
            if html:
                blocks.append(_table_block(html))
            else:
                tb = _text_block(ev.group(0))
                if tb:
                    blocks.append(tb)
        cursor = ev.end()
    if cursor < len(line):
        tb = _text_block(line[cursor:])
        if tb:
            blocks.append(tb)
    return blocks


def _blocks_from_lines(
    lines: list[str],
    images: dict[str, dict[str, Any]],
    tables: dict[str, str],
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        blocks.extend(_convert_line_to_blocks(line, images, tables))
    return blocks


def _merge_text_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse adjacent text blocks into one so prose stays together."""
    merged: list[dict[str, Any]] = []
    for block in blocks:
        if block["kind"] == "text" and merged and merged[-1].get("kind") == "text":
            merged[-1]["text"] = merged[-1]["text"] + "\n" + block["text"]
        else:
            merged.append(block)
    # drop empty text blocks
    return [b for b in merged if not (b["kind"] == "text" and not b["text"].strip())]


# ---------------------------------------------------------------------------
# Marks extraction
# ---------------------------------------------------------------------------


def _split_trailing_marks(line: str) -> tuple[str, int | None]:
    """Pull a trailing mark value off a part/question line."""
    m = _TRAILING_MARKS_RE.search(line)
    if not m:
        return line, None
    for g in m.groups():
        if g is not None:
            cleaned = line[: m.start()].rstrip(" .")
            return cleaned, int(g)
    return line, None


# ---------------------------------------------------------------------------
# Option + part parsing
# ---------------------------------------------------------------------------


def _parse_options(
    lines: list[str], images, tables
) -> tuple[list[dict[str, Any]] | None, int]:
    """Scan a contiguous block of A-D option lines. Returns (options, consumed).

    An option line may carry its content inline ("A. Up the page") or be a bare
    label whose content is the image/table on the following line(s) ("A." then
    "![img](img)"). Bare labels consume following image/table/text lines until
    the next option label or a question boundary.
    """
    options: list[dict[str, Any]] = []
    i = 0
    n = len(lines)
    expected = "A"
    while i < n:
        s = lines[i].strip()
        if not s:
            i += 1
            continue
        m = _OPTION_RE.match(s)
        label = _option_label_of(s)
        if not m or label != expected:
            break
        body = m.group(3).strip()
        i += 1
        content: list[dict[str, Any]] = []
        if body:
            # Options never carry trailing marks; keep the body verbatim so
            # numeric/decimal answers like "1.871" or "59" are not stripped.
            content = [b for b in _convert_line_to_blocks(body, images, tables) if b]
        else:
            # Bare label: gather following image/table/text lines until the next
            # option label or a question header/number.
            while i < n:
                t = lines[i].strip()
                if not t:
                    i += 1
                    continue
                if _OPTION_RE.match(t) or _line_is_question_header(t) or _line_is_question_number(t):
                    break
                content.extend(_convert_line_to_blocks(t, images, tables))
                i += 1
        content = _merge_text_blocks(content) or []
        if not content:
            content = [{"kind": "text", "text": ""}]
        options.append({"label": label, "content": content})
        expected = chr(ord(expected) + 1)
    if len(options) < 2:
        return None, 0
    return options, i


def _match_part_label(line: str) -> tuple[str, str | None] | None:
    """Return (label, body) for a part-label line; body is None for a bare label."""
    s = line.strip()
    m = _PART_LABEL_RE.match(s)
    if m:
        label = m.group(1) or m.group(2)
        return label, m.group(3)
    mb = _PART_LABEL_BARE_RE.match(s)
    if mb:
        return mb.group(1) or mb.group(2), None
    return None


def _label_tier(label: str, have_parent: bool) -> str:
    """Classify a part label as a top-level ('tier1') or nested ('tier2') part.

    HSC convention: letters a,b,c are top-level parts; roman numerals i,ii,iii
    and digits 1,2 are sub-parts. A digit is tier1 only when no letter parent
    exists yet (rare numbered-only questions).
    """
    if _ROMAN_RE.match(label):
        return "tier2"
    if label.isdigit():
        return "tier2" if have_parent else "tier1"
    # single letter
    return "tier1"


def _new_part(label: str, body: str | None, marks: int | None, images, tables) -> dict[str, Any]:
    content = [b for b in _convert_line_to_blocks(body or "", images, tables) if b] if body else []
    return {
        "label": label,
        "marks": marks,
        "content": _merge_text_blocks(content) or None,
        "parts": None,
    }


def _parse_parts(
    lines: list[str], images, tables
) -> list[dict[str, Any]]:
    """Parse labelled sub-parts into QuestionPart dicts with one level of nesting.

    Top-level parts (a, b, c, ...) may contain nested sub-parts (i, ii, ... or
    1, 2, ...). A bare label like "(a)" with no inline text starts a container
    whose content lives in its sub-parts.
    """
    parts: list[dict[str, Any]] = []
    i = 0
    n = len(lines)
    while i < n:
        s = lines[i].strip()
        if not s:
            i += 1
            continue
        if _line_is_question_header(s) is not None or _line_is_question_number(s):
            break
        matched = _match_part_label(s)
        if not matched:
            # continuation line: attach to the most recent open part/sub-part
            if parts:
                target = parts[-1]
                if target.get("parts"):
                    target = target["parts"][-1]
                if not target.get("content"):
                    target["content"] = []
                target["content"].extend(_convert_line_to_blocks(s, images, tables))
                target["content"] = _merge_text_blocks(target["content"]) or None
            i += 1
            continue
        label, body = matched
        body, marks = _split_trailing_marks(body) if body else (None, None)
        tier = _label_tier(label, have_parent=bool(parts))
        if tier == "tier1" or not parts:
            part = _new_part(label, body, marks, images, tables)
            parts.append(part)
        else:
            parent = parts[-1]
            if not parent.get("parts"):
                parent["parts"] = []
            sub = _new_part(label, body, marks, images, tables)
            parent["parts"].append(sub)
        i += 1

    # Finalise: ensure every part has content or sub-parts (schema requirement).
    for part in parts:
        if part.get("parts"):
            part["marks"] = part.get("marks") or sum(
                sp.get("marks") or 0 for sp in part["parts"]
            )
            if not part.get("content"):
                part["content"] = None
        else:
            part["parts"] = None
        if not part.get("content") and not part.get("parts"):
            part["content"] = [{"kind": "text", "text": ""}]
        for sub in part.get("parts") or []:
            if not sub.get("content") and not sub.get("parts"):
                sub["content"] = [{"kind": "text", "text": ""}]
    return parts


def _question_type(stem_has_options: bool, parts: list[dict[str, Any]] | None) -> str:
    if stem_has_options:
        return "multiple_choice"
    if parts and len(parts) >= 2:
        return "long_answer"
    return "short_answer"


def _build_mcq(
    number: int, stem_lines: list[str], options: list[dict[str, Any]], images, tables
) -> dict[str, Any]:
    stem_blocks = _merge_text_blocks(_blocks_from_lines(stem_lines, images, tables))
    marks = 1
    # MCQ marks sometimes appear in the stem header; default to 1.
    return {
        "number": number,
        "type": "multiple_choice",
        "marks": marks,
        "stimulus": None,
        "content": stem_blocks or None,
        "options": options,
        "parts": None,
        "answer": None,
    }


def _build_structured(
    number: int, header_marks: int | None, body_lines: list[str], images, tables
) -> dict[str, Any]:
    # Split body into pre-part stimulus and labelled parts.
    pre: list[str] = []
    i = 0
    while i < len(body_lines):
        s = body_lines[i].strip()
        if not s:
            i += 1
            continue
        if _match_part_label(s):
            break
        pre.append(body_lines[i])
        i += 1
    rest = body_lines[i:]
    stimulus = _merge_text_blocks(_blocks_from_lines(pre, images, tables)) or None
    parts = _parse_parts(rest, images, tables) if rest else None
    total = header_marks
    if total is None and parts:
        total = sum(p.get("marks") or 0 for p in parts)
    qtype = _question_type(False, parts)
    content = None
    if not parts:
        content = _merge_text_blocks(_blocks_from_lines(body_lines, images, tables)) or None
    return {
        "number": number,
        "type": qtype,
        "marks": total or 0,
        "stimulus": stimulus,
        "content": content,
        "options": None,
        "parts": parts,
        "answer": None,
    }


# ---------------------------------------------------------------------------
# Top-level parser
# ---------------------------------------------------------------------------


def _is_image_line(line: str) -> bool:
    return _IMAGE_MD_RE.search(line) is not None


def _option_label_of(line: str) -> str | None:
    m = _OPTION_RE.match(line.strip())
    if not m:
        return None
    return m.group(1) or m.group(2)


def _parse_image_options(
    lines: list[str], images, tables
) -> tuple[list[dict[str, Any]] | None, int]:
    """Synthesise A-D options from a run of 2-4 image lines with no labels."""
    options: list[dict[str, Any]] = []
    i = 0
    n = len(lines)
    expected = "A"
    while i < n and len(options) < 4:
        s = lines[i].strip()
        if not s:
            i += 1
            continue
        if not _is_image_line(s):
            break
        block = _convert_line_to_blocks(s, images, tables)
        block = [b for b in block if b]
        if not block:
            break
        options.append({"label": expected, "content": block})
        expected = chr(ord(expected) + 1)
        i += 1
    if len(options) < 2:
        return None, 0
    return options, i


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _options_from_table_html(html: str) -> list[dict[str, Any]] | None:
    """Extract A-D options from a table whose first column is A./B./C./D.

    Some HSC MCQs put their options as rows of a table (the OCR emits a single
    table instead of labelled lines). Each row's first cell is the label and the
    remaining cells form that option's content.
    """
    rows = re.findall(r"<tr>(.*?)</tr>", html, re.IGNORECASE | re.DOTALL)
    options: list[dict[str, Any]] = []
    for row in rows:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.IGNORECASE | re.DOTALL)
        if not cells:
            continue
        first = _strip_html(cells[0])
        m = re.match(r"^\(?\*?\s*([A-D])\)?\.?\*?\s*$", first)
        if not m:
            continue
        label = m.group(1)
        body = " ".join(_strip_html(c) for c in cells[1:] if _strip_html(c))
        content: list[dict[str, Any]] = []
        if body:
            content = [{"kind": "text", "text": body}]
        if not content:
            content = [{"kind": "text", "text": ""}]
        options.append({"label": label, "content": content})
    if len(options) < 2:
        return None
    # must be a contiguous A, B, C, ... sequence
    if [o["label"] for o in options] != [chr(ord("A") + k) for k in range(len(options))]:
        return None
    return options


def _find_table_options(
    stem_lines: list[str], tables: dict[str, str]
) -> tuple[list[dict[str, Any]] | None, str | None]:
    """If a table referenced in the stem holds A-D options, return them and the
    table id so the caller can drop the table reference from the stem."""
    for line in stem_lines:
        for m in _LINK_MD_RE.finditer(line):
            ref = m.group(2)
            html = tables.get(ref)
            if not html:
                continue
            opts = _options_from_table_html(html)
            if opts:
                return opts, ref
    return None, None


def _stem_gather_break(lines: list[str], j: int, n: int) -> bool:
    """Should stem gathering stop at line j? Stops at an option label, a
    question boundary, or an image that begins an option-image run."""
    t = lines[j].strip()
    if not t:
        return False
    if _line_is_question_header(t) is not None or _line_is_question_number(t):
        return True
    if _OPTION_RE.match(t):
        return True
    if _is_image_line(t):
        # Look ahead: if the next non-blank line is another image or an option
        # label, this image begins the option set rather than being stimulus.
        k = j + 1
        while k < n and not lines[k].strip():
            k += 1
        nxt = lines[k].strip() if k < n else ""
        if nxt and (_is_image_line(nxt) or _OPTION_RE.match(nxt)):
            return True
    return False


def _slice_questions(lines: list[str], images, tables) -> list[dict[str, Any]]:
    """Walk the paper's lines and emit questions.

    Handles three question shapes: numbered MCQs, "Question N (marks)" headers
    for long-answer questions, and orphan MCQ blocks whose number the OCR dropped
    (recovered as the previous number + 1).
    """
    questions: list[dict[str, Any]] = []
    seen_numbers: set[int] = set()
    last_number = 0
    pending: list[str] = []  # text/image lines buffered for an orphan MCQ stem
    i = 0
    n = len(lines)

    def emit(question: dict[str, Any]) -> None:
        questions.append(question)
        num = int(question.get("number") or 0)
        nonlocal last_number
        last_number = max(last_number, num)
        seen_numbers.add(num)

    while i < n:
        s = lines[i].strip()
        if not s:
            i += 1
            continue

        header_num = _line_is_question_header(s)
        if header_num is not None:
            if header_num in seen_numbers:
                # Spurious repeat (e.g. a back-page "Question N" marker) whose
                # real body was already absorbed into the original question.
                j = i + 1
                while j < n:
                    t = lines[j].strip()
                    if not t:
                        j += 1
                        continue
                    h = _line_is_question_header(t)
                    if h is not None and h != header_num:
                        break
                    if _line_is_question_number(t):
                        break
                    j += 1
                i = j
                pending = []
                continue
            header_marks = None
            hm = re.search(r"\((\d+)\s*marks?\)", s)
            if hm:
                header_marks = int(hm.group(1))
            body_start = i + 1
            j = body_start
            while j < n:
                t = lines[j].strip()
                if not t:
                    j += 1
                    continue
                h = _line_is_question_header(t)
                if h is not None:
                    if h == header_num:
                        # "Question N (continued)" — absorb, skip the marker line.
                        j += 1
                        continue
                    break
                if _line_is_question_number(t):
                    break
                j += 1
            body_lines = [ln for ln in lines[body_start:j] if not _is_boilerplate(ln)]
            emit(_build_structured(header_num, header_marks, body_lines, images, tables))
            pending = []
            i = j
            continue

        qn = _line_is_question_number(s)
        if qn is not None:
            number, first_body = qn
            stem_lines: list[str] = []
            if first_body:
                stem_lines.append(first_body)
            j = i + 1
            while j < n:
                if _stem_gather_break(lines, j, n):
                    break
                stem_lines.append(lines[j])
                j += 1
            option_lines = lines[j:]
            opt_start = 0
            while opt_start < len(option_lines) and not option_lines[opt_start].strip():
                opt_start += 1
            options, consumed = _parse_options(option_lines[opt_start:], images, tables)
            if not options:
                options, consumed = _parse_image_options(
                    option_lines[opt_start:], images, tables
                )
            if not options:
                # Options may live as rows of a table referenced in the stem.
                table_opts, table_ref = _find_table_options(stem_lines, tables)
                if table_opts:
                    options = table_opts
                    consumed = 0
                    stem_lines = [
                        ln for ln in stem_lines if table_ref is None or table_ref not in ln
                    ]
            if options:
                stem_lines = [ln for ln in stem_lines if not _is_boilerplate(ln)]
                emit(_build_mcq(number, stem_lines, options, images, tables))
                i = j + opt_start + consumed
            else:
                body_lines = [ln for ln in lines[i:j] if not _is_boilerplate(ln)]
                emit(_build_structured(number, None, body_lines, images, tables))
                i = j
            pending = []
            continue

        # Orphan MCQ: an option block whose number the OCR dropped. Use the
        # buffered text/image lines as the stem and number it after the last.
        if _option_label_of(s) == "A" and pending:
            options, consumed = _parse_options(lines[i:], images, tables)
            if options:
                stem_lines = [ln for ln in pending if not _is_boilerplate(ln)]
                emit(
                    _build_mcq(last_number + 1, stem_lines, options, images, tables)
                )
                pending = []
                i += consumed
                continue

        pending.append(lines[i])
        i += 1
    return questions


def _normalise_questions(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tidy: drop empty parts, ensure marks int, prune None parts lists."""
    out = []
    for q in questions:
        q = dict(q)
        q["marks"] = int(q.get("marks") or 0)
        if q.get("parts"):
            q["parts"] = [p for p in q["parts"] if p]
            if not q["parts"]:
                q["parts"] = None
        else:
            q["parts"] = None
        if q.get("options"):
            q["options"] = [o for o in q["options"] if o]
            if not q["options"]:
                q["options"] = None
        else:
            q["options"] = None
        for key in ("stimulus", "content"):
            if q.get(key) == []:
                q[key] = None
        out.append(q)
    return out


def extract_paper(mistral_doc: dict[str, Any]) -> dict[str, Any]:
    """Convert a Mistral OCR document into a tppr paper document."""
    stream = _build_stream(mistral_doc)
    raw_lines = stream.lines
    images, tables = stream.images, stream.tables

    year = _find_year(raw_lines)
    subject = _find_subject(raw_lines) or ""
    school = _find_school(raw_lines)
    source = _find_source(school, raw_lines)
    duration = _find_duration(raw_lines)
    total_marks = _find_total_marks(raw_lines)
    course_level = _COURSE_LEVEL_MAP.get(subject.lower())

    # Drop boilerplate; section headings are treated as boilerplate too, so the
    # whole paper is walked as one stream and each question is detected by its
    # number/header. Question type is inferred per-question from options/parts,
    # so the section split is not needed.
    kept: list[str] = [line for line in raw_lines if not _is_boilerplate(line)]

    questions = _slice_questions(kept, images, tables)

    questions = _normalise_questions(questions)
    # Renumber sequentially in case OCR skipped one; keep original where present.
    for i, q in enumerate(questions, start=1):
        if not q.get("number"):
            q["number"] = i

    total_marks = total_marks or sum(int(q.get("marks") or 0) for q in questions)

    title_subject = subject or "Paper"
    title_year = f" {year}" if year else ""
    if school:
        title = f"{school} {title_year} {title_subject} Trial"
    else:
        title = f"{year or ''} HSC {title_subject}".strip()
        title = re.sub(r"\s+", " ", title)

    # Stamp the fields the frontend importer (frontend/src/lib/paper-import.ts
    # -> isValidTpprPaper) requires on every paper and question. The importer
    # reassigns id/author_id/timestamps, so placeholder values are fine; they
    # just have to be present and well-typed so the file passes validation.
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    paper_id = str(uuid.uuid4())
    for q in questions:
        q.setdefault("id", str(uuid.uuid4()))
        q.setdefault("paper_id", paper_id)
        q.setdefault("author_id", "")
        q.setdefault("created_at", now)
        q.setdefault("updated_at", now)

    return {
        "id": paper_id,
        "title": title.strip(),
        "author_id": "",
        "subject": subject or "",
        "year": year,
        "source": source,
        "school": school,
        "course_level": course_level,
        "syllabus_id": None,
        "visibility": "private",
        "question_count": len(questions),
        "total_marks": total_marks,
        "duration_minutes": duration,
        "topics": [],
        "outcomes": [],
        "created_at": now,
        "updated_at": now,
        "questions": questions,
    }


def extract_paper_from_text(mistral_text: str) -> dict[str, Any]:
    """Parse a JSON string of a Mistral OCR document."""
    return extract_paper(json.loads(mistral_text))


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _structural_errors(paper: dict[str, Any]) -> list[str]:
    """Check the paper document against the tppr content shapes (stdlib only)."""
    errs: list[str] = []
    label_re = re.compile(r"^[A-Z]$")
    part_label_re = re.compile(r"^[A-Za-z0-9]+$")
    valid_types = {"multiple_choice", "short_answer", "long_answer"}
    valid_kinds = {"text", "image", "table"}

    def check_blocks(blocks, path):
        for b in blocks or []:
            if not isinstance(b, dict) or b.get("kind") not in valid_kinds:
                errs.append(f"{path}: invalid block {b!r}")
                continue
            if b["kind"] == "text" and not isinstance(b.get("text"), str):
                errs.append(f"{path}: text block missing text")
            if b["kind"] == "image" and not b.get("url"):
                errs.append(f"{path}: image block missing url")
            if b["kind"] == "table" and not b.get("html"):
                errs.append(f"{path}: table block missing html")

    def check_part(p, path):
        if not part_label_re.match(str(p.get("label", ""))):
            errs.append(f"{path}: invalid part label {p.get('label')!r}")
        check_blocks(p.get("stimulus"), f"{path}.stimulus")
        check_blocks(p.get("content"), f"{path}.content")
        for i, sp in enumerate(p.get("parts") or []):
            check_part(sp, f"{path}.parts[{i}]")
        if not p.get("content") and not p.get("parts"):
            errs.append(f"{path}: part has neither content nor parts")

    for q in paper.get("questions", []):
        n = q.get("number")
        if q.get("type") not in valid_types:
            errs.append(f"Q{n}: invalid type {q.get('type')!r}")
        if not isinstance(q.get("marks"), int) or q["marks"] < 0:
            errs.append(f"Q{n}: invalid marks {q.get('marks')!r}")
        check_blocks(q.get("stimulus"), f"Q{n}.stimulus")
        check_blocks(q.get("content"), f"Q{n}.content")
        for i, o in enumerate(q.get("options") or []):
            if not label_re.match(str(o.get("label", ""))):
                errs.append(f"Q{n}.option[{i}]: invalid label {o.get('label')!r}")
            check_blocks(o.get("content"), f"Q{n}.option[{i}]")
        for i, p in enumerate(q.get("parts") or []):
            check_part(p, f"Q{n}.parts[{i}]")
        if q.get("type") == "multiple_choice" and not q.get("options"):
            errs.append(f"Q{n}: multiple_choice question has no options")
        if q.get("type") != "multiple_choice" and q.get("options"):
            errs.append(f"Q{n}: non-multiple_choice question has options")
    return errs


def validate_paper(paper: dict[str, Any]) -> list[str]:
    """Return a list of schema error strings (empty means valid).

    Prefers the backend's pydantic models when ``questions.types`` is importable
    (i.e. when run inside the backend environment); otherwise falls back to a
    stdlib structural check that mirrors the same constraints.
    """
    try:
        import importlib
        types = importlib.import_module("questions.types")
    except Exception:
        return _structural_errors(paper)

    errs: list[str] = []
    try:
        for q in paper.get("questions", []):
            payload = {k: v for k, v in q.items() if k != "number"}
            types.QuestionCreate.model_validate(payload)
    except Exception as exc:  # noqa: BLE001 - surface every validation failure
        errs.append(str(exc))
    return errs