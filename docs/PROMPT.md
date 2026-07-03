Convert this exam paper into a tppr JSON format. Follow the schema exactly.

## Paper-level structure

{ "id": "<generate a UUID v4>", "title": "<Paper title, e.g. '2024 {school}
Mathematics Advanced'>", "author_id": "1", "subject": "<subject name>",
"visibility": "private", "question_count": <total number of questions>,
"total_marks": <sum of all question marks>, "duration_minutes": <exam duration
if stated, else null>, "created_at": "<current ISO datetime>", "updated_at":
"<current ISO datetime>", "questions": [...] }

## Question types

- `multiple_choice`: Has `options` array with labels A/B/C/D. Set
  `answer.option_label` to the correct letter. If not provided in the paper,
  determine the correct answer yourself.
- `short_answer`: Single-part question worth typically 1-4 marks. Uses `content`
  for the question text.
- `long_answer`: Multi-part question. Has `parts` array with labels "a", "b",
  "c" etc. Each part has its own `content`, `marks`, and optional `stimulus`.
  Set `content` at question level to `null` when using parts.

## Content blocks

Text uses: `{"kind": "text", "text": "..."}` Images use:
`{"kind": "image", "url": "IMAGE_PLACEHOLDER_<sequential_number>", "mime_type": "image/png"}`
Tables use: `{"kind": "table", "html": "<table>...</table>"}`

For math notation, use LaTeX with `$...$` for inline and `$$...$$` for display.
Example: `"$x^2 + 3x + 2 = 0$"`

## Question structure

{ "id": "<UUID v4>", "paper_id": "<same as paper id>", "author_id": "1",
"number": <question number>, "type": "multiple_choice" | "short_answer" |
"long_answer", "marks": <total marks for this question>, "stimulus":
[<ContentBlock array>] or null, "content": [<ContentBlock array>] or null,
"parts": [<QuestionPart array>] or null, "options": [{"label": "A", "content":
[<ContentBlock>]}, ...] or null, "answer": {"option_label": "A", "summary":
null, "content": null, "alternatives": null} or null, "difficulty": null,
"topics": [], "syllabus_points": [], "outcomes": [], "rubric": null,
"guidelines": null, "created_at": "<ISO datetime>", "updated_at":
"<ISO datetime>", "source_paper_id": null, "source_question_id": null,
"source_removed": false, "remixed_from": null }

## QuestionPart structure (for long_answer)

{ "label": "a", "stimulus": [<ContentBlock>] or null, "content": [{"kind":
"text", "text": "..."}], "marks": <marks for this part>, "is_independent": <true
if this part can stand alone without prior parts' context>, "answer":
{"option_label": null, "summary": "<concise answer>", "content": [{"kind":
"text", "text": "<worked solution>"}], "alternatives": null}, "rubric": null,
"guidelines": null }

## Rules

1. stimulus = contextual material BEFORE the question (diagrams, scenarios, data
   tables). Put it in `stimulus`, not `content`.
2. content = the actual question being asked.
3. For multi-part questions (a, b, c...), use `type: "long_answer"` with
   `parts`. Set question-level `content` to `null`.
4. If a part has its own unique stimulus (e.g. "The graph below shows..."), put
   it in that part's `stimulus`.
5. If ALL parts share a common stimulus, put it in the question-level
   `stimulus`.
6. Mark images sequentially as IMAGE_PLACEHOLDER_1, IMAGE_PLACEHOLDER_2, etc. I
   will replace these with actual asset URLs later.
7. Tables from the paper should use `{"kind": "table", "html": "..."}` with
   proper HTML table markup.
8. Use `is_independent: true` when a part doesn't depend on previous parts'
   context.
9. Marks on a `long_answer` question = sum of all part marks.
10. Generate unique UUIDs for every `id` field.
11. Remove OCR junk and administrative rubbish before writing content. Keep only
    material needed to answer the questions: question text, stimulus, diagrams,
    tables, options, marks, answer keys, and marking criteria. Drop personal
    identifiers, cover-page form fields, seating/centre metadata, blank writing
    areas, page furniture, repeated headers/footers, barcode text, scanning
    artefacts, and exam-room instructions that are not part of a question.
12. Do not preserve labelled blank fields or filled-in administrative fields in
    the paper title, stimulus, question content, options, answers, or rubrics.
13. ALWAYS populate the `answer` field. If the paper includes answers or a
    marking guide, use those. If not, solve the question yourself and provide:
    - For multiple_choice: set `answer.option_label` to the correct letter and
      `answer.summary` explaining why.
    - For short_answer: set `answer.summary` to the final answer and
      `answer.content` to the worked solution.
    - For long_answer parts: set each part's `answer.summary` to a concise model
      answer and `answer.content` to a worked solution or marking criteria table
      in markdown format (e.g.
      `| Criteria | Marks |\n| --- | ---: |\n| ... | ... |`).

Output ONLY the JSON. No explanation or markdown fencing.
