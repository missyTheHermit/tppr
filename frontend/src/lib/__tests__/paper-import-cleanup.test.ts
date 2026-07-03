import { describe, expect, it } from "vitest";

import { cleanImportedPaperContent } from "../paper-import";
import type { Paper } from "@/types/tppr-paper";

const basePaper: Paper = {
    id: "paper-1",
    title: "Imported paper",
    author_id: "author-1",
    subject: "Mathematics Advanced",
    visibility: "private",
    question_count: 1,
    total_marks: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    questions: [
        {
            id: "q-1",
            paper_id: "paper-1",
            author_id: "author-1",
            number: 1,
            type: "multiple_choice",
            marks: 1,
            content: [{ kind: "text", text: "Name: Example Person\nWhat is $2+2$?" }],
            options: [
                { label: "A", content: [{ kind: "text", text: "Candidate No: 12345678\n3" }] },
                { label: "B", content: [{ kind: "text", text: "4" }] },
            ],
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
        },
    ],
};

describe("import cleanup", () => {
    it("drops OCR rubbish without dropping question material", () => {
        const cleaned = cleanImportedPaperContent(basePaper);
        const text = JSON.stringify(cleaned);

        expect(text).not.toContain("Example Person");
        expect(text).not.toContain("12345678");
        expect(text).toContain("What is $2+2$?");
        expect(text).toContain("4");
    });
});
