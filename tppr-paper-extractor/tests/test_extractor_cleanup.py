from tppr_paper_extractor import extract_paper, validate_paper


def _text_blocks_from_question(question):
    blocks = []
    for key in ("stimulus", "content"):
        blocks.extend(question.get(key) or [])
    for option in question.get("options") or []:
        blocks.extend(option.get("content") or [])
    for part in question.get("parts") or []:
        blocks.extend(part.get("content") or [])
    return "\n".join(block.get("text", "") for block in blocks if block.get("kind") == "text")


def test_extract_paper_drops_admin_fields_and_keeps_questions():
    paper = extract_paper({
        "pages": [
            {
                "markdown": """
# Mathematics Advanced
Name: Example Person
Candidate No: 12345678
Class: 12A
____ ____ ____
2 | Page

1. What is $2+2$?
A. 3
B. 4
C. 5
D. 6

Question 2 (2 marks)
(a) Find the value of $x$ if $x+1=3$. 1
(b) Explain your reasoning. 1
""",
                "images": [],
                "tables": [],
            }
        ]
    })

    assert validate_paper(paper) == []
    assert paper["question_count"] == 2

    joined = "\n".join(_text_blocks_from_question(q) for q in paper["questions"])
    assert "Example Person" not in joined
    assert "12345678" not in joined
    assert "Class:" not in joined
    assert "Page" not in joined
    assert "What is $2+2$?" in joined
    assert "Explain your reasoning" in joined
