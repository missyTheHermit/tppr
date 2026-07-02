import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PydanticField
from pydantic import model_validator
from sqlalchemy import Column, Index, LargeBinary, Text, UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

# NOTE: This module was made with AI

# ---------------------------------------------------------------------------
# enumerate
# ---------------------------------------------------------------------------

Visibility = Literal["private", "public", "removed"]

VerificationRequestStatus = Literal["pending", "approved", "rejected"]

QuestionType = Literal[
    "multiple_choice",
    "short_answer",
    "long_answer",
]

Difficulty = Literal[
    "easy",
    "medium",
    "hard",
]

PaperSource = Literal[
    "hsc",
    "trial",
    "internal",
    "practice",
    "custom",
]

CourseLevel = Literal[
    "standard",
    "advanced",
    "extension_1",
    "extension_2",
]


class LenientBaseModel(BaseModel):
    """Base model that silently ignores unknown fields, used for models
    that deserialise LLM-generated JSON which may contain extra keys."""
    model_config = ConfigDict(extra="ignore")


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SyllabusPoint(StrictBaseModel):
    syllabus_id: str = PydanticField(
        description="Identifier for the syllabus, e.g. 'hsc-physics-2025'."
    )
    point_code: str = PydanticField(
        description="Dot-point code within the syllabus, e.g. 'PH12-4.1.3'."
    )
    label: str | None = PydanticField(
        default=None,
        description="Human-readable label for the syllabus point.",
    )


class TextBlock(LenientBaseModel):
    kind: Literal["text"]
    text: str


class ImageBlock(LenientBaseModel):
    kind: Literal["image"]
    url: str
    mime_type: str | None = None
    alt: str | None = None
    width: int | None = PydanticField(default=None, ge=1)
    height: int | None = PydanticField(default=None, ge=1)


class TableBlock(LenientBaseModel):
    kind: Literal["table"]
    html: str = PydanticField(min_length=1)


ContentBlock = Annotated[
    TextBlock | ImageBlock | TableBlock,
    PydanticField(discriminator="kind"),
]


class ChoiceOption(LenientBaseModel):
    label: str = PydanticField(
        pattern=r"^[A-Z]$",
        description="Option letter, e.g. A, B, C, D.",
    )
    content: list[ContentBlock] = PydanticField(min_length=1)


class QuestionAnswer(LenientBaseModel):
    option_label: str | None = PydanticField(
        default=None,
        pattern=r"^[A-Z]$",
        description="Correct option label for multiple-choice questions.",
    )
    summary: str | None = PydanticField(
        default=None,
        description="Concise final answer or answer summary.",
    )
    content: list[ContentBlock] | None = PydanticField(
        default=None,
        description="Worked solution or answer content.",
    )
    alternatives: list[list[ContentBlock]] | None = PydanticField(
        default=None,
        description="Alternative valid answer forms or solution paths.",
    )


def _parse_answer(raw: str | None) -> str | QuestionAnswer | None:
    """Deserialize a plain string or JSON-encoded QuestionAnswer."""
    if raw is None:
        return None
    if raw.startswith("{"):
        try:
            return QuestionAnswer.model_validate(json.loads(raw))
        except Exception:
            return raw
    return raw


class RubricCriterion(LenientBaseModel):
    label: str | None = PydanticField(
        default=None,
        description="Optional criterion label or band name.",
    )
    marks: int | None = PydanticField(
        default=None,
        ge=0,
        description="Exact marks awarded when this criterion is met.",
    )
    min_marks: int | None = PydanticField(
        default=None,
        ge=0,
        description="Lower bound for a mark range.",
    )
    max_marks: int | None = PydanticField(
        default=None,
        ge=0,
        description="Upper bound for a mark range.",
    )
    description: list[ContentBlock] = PydanticField(
        min_length=1,
        description="Criterion description, including notation or tables.",
    )


class QuestionRubric(LenientBaseModel):
    criteria: list[RubricCriterion] = PydanticField(min_length=1)
    notes: list[ContentBlock] | None = PydanticField(
        default=None,
        description="Additional marking notes not tied to a single criterion.",
    )


class QuestionPart(LenientBaseModel):
    label: str = PydanticField(
        pattern=r"^[A-Za-z0-9]+$",
        description="Part label segment, e.g. 'a', 'i', '1', 'A'. Compound labels "
        "like '1.a.i' are rendered from the path of labels, not stored here.",
    )
    stimulus: list[ContentBlock] | None = PydanticField(
        default=None,
        description="Stimulus material for this sub-part.",
    )
    content: list[ContentBlock] | None = PydanticField(
        default=None,
        description="Question text for a leaf part, or optional intro text for a "
        "container part. A part must have either non-empty content or non-empty "
        "parts (see validator below).",
    )
    marks: int | None = PydanticField(default=None, ge=0)
    is_independent: bool | None = PydanticField(
        default=None,
        description="True if this part stands alone from the previous part's context.",
    )
    answer: str | QuestionAnswer | None = PydanticField(
        default=None,
        description="Answer material for this sub-part (only meaningful on leaves).",
    )
    rubric: QuestionRubric | None = None
    guidelines: list[ContentBlock] | None = PydanticField(
        default=None,
        description="General marking guidelines, feedback, common errors or comments.",
    )
    parts: list["QuestionPart"] | None = PydanticField(
        default=None,
        description="Nested sub-parts for arbitrarily deep questions, e.g. 1.a.i. "
        "A part with sub-parts is a container: it carries stimulus (+ optional intro "
        "content) and its marks are the sum of its children's marks.",
    )

    @model_validator(mode="after")
    def _require_content_or_parts(self) -> "QuestionPart":
        has_content = bool(self.content)
        has_parts = bool(self.parts)
        if not has_content and not has_parts:
            raise ValueError(
                "A question part must have either content or nested parts."
            )
        return self


# Resolve the self-referential `parts` forward reference (the module does not
# use `from __future__ import annotations`).
QuestionPart.model_rebuild()


# ---------------------------------------------------------------------------
# JSON column type adapter for SQLite
# ---------------------------------------------------------------------------


class JSONEncodedList(list):
    """Marker so SQLAlchemy knows to serialise as JSON text."""


# ---------------------------------------------------------------------------
# Junction / link tables (SQLModel with table=True)
# ---------------------------------------------------------------------------


class PaperOutcome(SQLModel, table=True):
    __tablename__ = "paper_outcomes"

    paper_id: str = Field(foreign_key="papers.id", primary_key=True)
    outcome_code: str = Field(primary_key=True)


class QuestionOutcome(SQLModel, table=True):
    __tablename__ = "question_outcomes"

    question_id: str = Field(foreign_key="questions.id", primary_key=True)
    outcome_code: str = Field(primary_key=True)


class QuestionSyllabusPointDB(SQLModel, table=True):
    """Syllabus dot-point references stored relationally for querying."""

    __tablename__ = "question_syllabus_points"
    __table_args__ = (Index("ix_question_syllabus_points_question_id", "question_id"),)

    id: int | None = Field(default=None, primary_key=True)
    question_id: str = Field(foreign_key="questions.id")
    syllabus_id: str
    point_code: str
    label: str | None = None


class AssetDB(SQLModel, table=True):
    """Binary assets referenced by asset:// URLs in paper content."""

    __tablename__ = "assets"

    id: str = Field(primary_key=True)
    paper_id: str = Field(foreign_key="papers.id")
    uploader_id: str
    mime_type: str
    filename: str | None = None
    data: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


# ---------------------------------------------------------------------------
# Main table models
# ---------------------------------------------------------------------------


class PaperDB(SQLModel, table=True):
    """The `papers` table."""

    __tablename__ = "papers"
    __table_args__ = (
        Index("ix_papers_author_id", "author_id"),
        Index("ix_papers_remixed", "remixed"),
    )

    id: str = Field(primary_key=True)
    title: str
    author_id: str
    subject: str
    syllabus_id: str | None = None
    year: int | None = None
    source: str | None = None  # PaperSource
    school: str | None = None
    course_level: str | None = None  # CourseLevel
    visibility: str = Field(default="private")  # Visibility
    question_count: int = Field(default=0)
    total_marks: int = Field(default=0)
    duration_minutes: int | None = None
    topics_json: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    remixed: str | None = Field(default=None)
    verified: bool = Field(default=False)
    verified_source_name: str | None = None
    verified_source_url: str | None = None
    verified_at: datetime | None = None
    verified_by: str | None = None

    # Relationships
    questions: list["QuestionDB"] = Relationship(
        back_populates="paper",
        sa_relationship_kwargs={
            "cascade": "all, delete-orphan",
            "lazy": "selectin",
        },
    )
    outcomes: list["PaperOutcome"] = Relationship(
        sa_relationship_kwargs={
            "cascade": "all, delete-orphan",
            "lazy": "selectin",
        },
    )

    # --- JSON helpers ---

    def get_topics(self) -> list[str]:
        if not self.topics_json:
            return []
        return json.loads(self.topics_json)

    def set_topics(self, topics: list[str] | None) -> None:
        if topics is None:
            self.topics_json = None
        else:
            self.topics_json = json.dumps(topics)


class PaperVerificationRequestDB(SQLModel, table=True):
    """Owner-submitted request for an admin to verify a paper."""

    __tablename__ = "paper_verification_requests"
    __table_args__ = (
        Index("ix_paper_verification_requests_paper_id", "paper_id"),
        Index("ix_paper_verification_requests_status", "status"),
        Index("ix_paper_verification_requests_created_at", "created_at"),
    )

    id: str = Field(primary_key=True)
    paper_id: str = Field(foreign_key="papers.id")
    requester_id: str
    source_name: str
    source_url: str | None = None
    note: str | None = None
    status: str = Field(default="pending")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    resolved_at: datetime | None = None
    resolved_by: str | None = None
    admin_note: str | None = None


class QuestionDB(SQLModel, table=True):
    """The `questions` table."""

    __tablename__ = "questions"
    __table_args__ = (
        UniqueConstraint("paper_id", "number"),
        Index("ix_questions_author_id", "author_id"),
    )

    id: str = Field(primary_key=True)
    paper_id: str = Field(foreign_key="papers.id")
    author_id: str
    number: int
    type: str  # QuestionType
    marks: int = Field(default=0)

    # Complex nested data stored as JSON text
    stimulus_json: str | None = Field(default=None, sa_column=Column(Text))
    content_json: str | None = Field(default=None, sa_column=Column(Text))
    parts_json: str | None = Field(default=None, sa_column=Column(Text))
    options_json: str | None = Field(default=None, sa_column=Column(Text))
    topics_json: str | None = Field(default=None, sa_column=Column(Text))

    answer: str | None = None
    difficulty: str | None = None  # Difficulty
    remixed_from: str | None = Field(default=None)
    source_question_id: str | None = Field(default=None)
    source_paper_id: str | None = Field(default=None)
    verified_fingerprint: str | None = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    paper: Optional[PaperDB] = Relationship(back_populates="questions")
    outcomes: list["QuestionOutcome"] = Relationship(
        sa_relationship_kwargs={"lazy": "selectin"},
    )
    syllabus_points: list["QuestionSyllabusPointDB"] = Relationship(
        sa_relationship_kwargs={"lazy": "selectin"},
    )

    # --- JSON helpers ---

    def get_stimulus(self) -> list[ContentBlock] | None:
        if not self.stimulus_json:
            return None
        return _parse_content_blocks(self.stimulus_json)

    def set_stimulus(self, blocks: list[ContentBlock] | None) -> None:
        self.stimulus_json = _dump_blocks(blocks)

    def get_content(self) -> list[ContentBlock] | None:
        if not self.content_json:
            return None
        return _parse_content_blocks(self.content_json)

    def set_content(self, blocks: list[ContentBlock] | None) -> None:
        self.content_json = _dump_blocks(blocks)

    def get_parts(self) -> list[QuestionPart] | None:
        if not self.parts_json:
            return None
        raw = json.loads(self.parts_json)
        return [QuestionPart.model_validate(p) for p in raw]

    def set_parts(self, parts: list[QuestionPart] | None) -> None:
        if parts is None:
            self.parts_json = None
        else:
            self.parts_json = json.dumps([p.model_dump() for p in parts])

    def get_options(self) -> list[ChoiceOption] | None:
        if not self.options_json:
            return None
        raw = json.loads(self.options_json)
        return [ChoiceOption.model_validate(o) for o in raw]

    def set_options(self, options: list[ChoiceOption] | None) -> None:
        if options is None:
            self.options_json = None
        else:
            self.options_json = json.dumps([o.model_dump() for o in options])

    def get_topics(self) -> list[str]:
        if not self.topics_json:
            return []
        return json.loads(self.topics_json)

    def set_topics(self, topics: list[str] | None) -> None:
        if topics is None:
            self.topics_json = None
        else:
            self.topics_json = json.dumps(topics)


# ---------------------------------------------------------------------------
# API response models (not tables — used for serialization)
# ---------------------------------------------------------------------------


class QuestionRead(BaseModel):
    """Full question as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    paper_id: str
    author_id: str
    number: int
    type: QuestionType
    marks: int
    stimulus: list[ContentBlock] | None = None
    content: list[ContentBlock] | None = None
    parts: list[QuestionPart] | None = None
    options: list[ChoiceOption] | None = None
    answer: str | QuestionAnswer | None = None
    rubric: QuestionRubric | None = None
    guidelines: list[ContentBlock] | None = None
    topics: list[str] = []
    outcomes: list[str] = []
    syllabus_points: list[SyllabusPoint] = []
    difficulty: Difficulty | None = None
    remixed_from: str | None = None
    source_question_id: str | None = None
    source_paper_id: str | None = None
    source_removed: bool = False
    verified_changed: bool = False
    created_at: datetime
    updated_at: datetime


class PaperMetaRead(BaseModel):
    """Paper metadata without questions."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    author_id: str
    subject: str
    syllabus_id: str | None = None
    year: int | None = None
    source: PaperSource | None = None
    school: str | None = None
    course_level: CourseLevel | None = None
    topics: list[str] = []
    outcomes: list[str] = []
    visibility: Visibility = "private"
    question_count: int = 0
    total_marks: int = 0
    duration_minutes: int | None = None
    created_at: datetime
    updated_at: datetime
    remixed: str | None = Field(default=None)
    verified: bool = False
    verified_source_name: str | None = None
    verified_source_url: str | None = None
    verified_at: datetime | None = None
    verified_by: str | None = None


class PaperRead(PaperMetaRead):
    """Full paper with questions included."""

    syllabus_id: str | None = None
    remixed: str | None = Field(default=None)
    questions: list[QuestionRead] = []


class PaperVerificationRequestRead(BaseModel):
    """Verification request returned to paper owners and admins."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    paper_id: str
    requester_id: str
    source_name: str
    source_url: str | None = None
    note: str | None = None
    status: VerificationRequestStatus = "pending"
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    resolved_by: str | None = None
    admin_note: str | None = None


# ---------------------------------------------------------------------------
# Request/create models
# ---------------------------------------------------------------------------


class PaperCreate(BaseModel):
    title: str = PydanticField(min_length=1)
    subject: str
    syllabus_id: str | None = None
    year: int | None = PydanticField(default=None, ge=2000)
    source: PaperSource | None = None
    school: str | None = None
    course_level: CourseLevel | None = None
    topics: list[str] | None = None
    outcomes: list[str] | None = None
    visibility: Visibility = "private"
    duration_minutes: int | None = PydanticField(default=None, ge=0)


class PaperUpdate(BaseModel):
    title: str | None = PydanticField(default=None, min_length=1)
    subject: str | None = None
    syllabus_id: str | None = None
    year: int | None = PydanticField(default=None, ge=2000)
    source: PaperSource | None = None
    school: str | None = None
    course_level: CourseLevel | None = None
    topics: list[str] | None = None
    outcomes: list[str] | None = None
    visibility: Visibility | None = None
    duration_minutes: int | None = PydanticField(default=None, ge=0)


class QuestionCreate(BaseModel):
    type: QuestionType
    marks: int = PydanticField(ge=0)
    stimulus: list[ContentBlock] | None = None
    content: list[ContentBlock] | None = None
    parts: list[QuestionPart] | None = None
    options: list[ChoiceOption] | None = None
    answer: str | QuestionAnswer | None = None
    rubric: QuestionRubric | None = None
    guidelines: list[ContentBlock] | None = None
    topics: list[str] | None = None
    outcomes: list[str] | None = None
    syllabus_points: list[SyllabusPoint] | None = None
    difficulty: Difficulty | None = None
    remixed_from: str | None = None
    source_question_id: str | None = None
    source_paper_id: str | None = None


class QuestionUpdate(BaseModel):
    type: QuestionType | None = None
    marks: int | None = PydanticField(default=None, ge=0)
    stimulus: list[ContentBlock] | None = None
    content: list[ContentBlock] | None = None
    parts: list[QuestionPart] | None = None
    options: list[ChoiceOption] | None = None
    answer: str | QuestionAnswer | None = None
    rubric: QuestionRubric | None = None
    guidelines: list[ContentBlock] | None = None
    topics: list[str] | None = None
    outcomes: list[str] | None = None
    syllabus_points: list[SyllabusPoint] | None = None
    difficulty: Difficulty | None = None
    remixed_from: str | None = None
    source_question_id: str | None = None
    source_paper_id: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_content_blocks(raw_json: str) -> list[Any]:
    """Parse a JSON string into a list of ContentBlock models."""
    data = json.loads(raw_json)
    blocks: list[Any] = []
    for item in data:
        if item.get("kind") == "text" and not item.get("text"):
            continue  # skip empty text blocks
        kind = item.get("kind")
        if kind == "text":
            blocks.append(TextBlock.model_validate(item))
        elif kind == "image":
            blocks.append(ImageBlock.model_validate(item))
        elif kind == "table":
            blocks.append(TableBlock.model_validate(item))
    return blocks


def _dump_blocks(blocks: list[Any] | None) -> str | None:
    """Serialize a list of ContentBlock models to JSON string."""
    if blocks is None:
        return None
    return json.dumps([b.model_dump() for b in blocks])


def _canonical_json_value(raw: str | None) -> Any:
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return raw


def question_verified_fingerprint(q: QuestionDB) -> str:
    """Stable fingerprint of the question fields covered by verification."""
    payload = {
        "type": q.type,
        "marks": q.marks,
        "stimulus": _canonical_json_value(q.stimulus_json),
        "content": _canonical_json_value(q.content_json),
        "parts": _canonical_json_value(q.parts_json),
        "options": _canonical_json_value(q.options_json),
        "topics": _canonical_json_value(q.topics_json),
        "answer": _canonical_json_value(q.answer),
        "difficulty": q.difficulty,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def question_db_to_read(
    q: QuestionDB,
    *,
    source_removed: bool = False,
    paper_verified: bool = False,
) -> QuestionRead:
    """Convert a QuestionDB row into a QuestionRead API model."""
    verified_changed = (
        paper_verified
        and q.verified_fingerprint is not None
        and q.verified_fingerprint != question_verified_fingerprint(q)
    )
    return QuestionRead(
        id=q.id,
        paper_id=q.paper_id,
        author_id=q.author_id,
        number=q.number,
        type=q.type,  # type: ignore[arg-type]
        marks=q.marks,
        stimulus=q.get_stimulus(),
        content=q.get_content(),
        parts=q.get_parts(),
        options=q.get_options(),
        answer=_parse_answer(q.answer),
        topics=q.get_topics(),
        outcomes=[o.outcome_code for o in q.outcomes],
        syllabus_points=[
            SyllabusPoint(
                syllabus_id=sp.syllabus_id,
                point_code=sp.point_code,
                label=sp.label,
            )
            for sp in q.syllabus_points
        ],
        difficulty=q.difficulty,  # type: ignore[arg-type]
        remixed_from=q.remixed_from,
        source_question_id=q.source_question_id,
        source_paper_id=q.source_paper_id,
        source_removed=source_removed,
        verified_changed=verified_changed,
        created_at=q.created_at,
        updated_at=q.updated_at,
    )


def paper_db_to_meta_read(p: PaperDB) -> PaperMetaRead:
    """Convert a PaperDB row into a PaperMetaRead API model."""
    return PaperMetaRead(
        id=p.id,
        title=p.title,
        author_id=p.author_id,
        subject=p.subject,
        syllabus_id=p.syllabus_id,
        year=p.year,
        source=p.source,  # type: ignore[arg-type]
        school=p.school,
        course_level=p.course_level,  # type: ignore[arg-type]
        topics=p.get_topics(),
        outcomes=[o.outcome_code for o in p.outcomes],
        visibility=p.visibility,  # type: ignore[arg-type]
        question_count=p.question_count,
        total_marks=p.total_marks,
        duration_minutes=p.duration_minutes,
        created_at=p.created_at,
        updated_at=p.updated_at,
        remixed=p.remixed,
        verified=p.verified,
        verified_source_name=p.verified_source_name,
        verified_source_url=p.verified_source_url,
        verified_at=p.verified_at,
        verified_by=p.verified_by,
    )


def paper_db_to_read(
    p: PaperDB,
    *,
    questions: list[QuestionRead] | None = None,
    question_count: int | None = None,
    total_marks: int | None = None,
) -> PaperRead:
    """Convert a PaperDB row into a full PaperRead API model."""
    read_questions = (
        questions
        if questions is not None
        else [question_db_to_read(q, paper_verified=p.verified) for q in p.questions]
    )
    return PaperRead(
        id=p.id,
        title=p.title,
        author_id=p.author_id,
        subject=p.subject,
        syllabus_id=p.syllabus_id,
        year=p.year,
        source=p.source,  # type: ignore[arg-type]
        school=p.school,
        course_level=p.course_level,  # type: ignore[arg-type]
        topics=p.get_topics(),
        outcomes=[o.outcome_code for o in p.outcomes],
        visibility=p.visibility,  # type: ignore[arg-type]
        question_count=p.question_count if question_count is None else question_count,
        total_marks=p.total_marks if total_marks is None else total_marks,
        duration_minutes=p.duration_minutes,
        created_at=p.created_at,
        updated_at=p.updated_at,
        remixed=p.remixed,
        verified=p.verified,
        verified_source_name=p.verified_source_name,
        verified_source_url=p.verified_source_url,
        verified_at=p.verified_at,
        verified_by=p.verified_by,
        questions=read_questions,
    )
