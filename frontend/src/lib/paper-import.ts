import type {
    ContentBlock,
    Paper,
    QuestionAnswer,
    QuestionPart,
    QuestionRubric,
} from "@/types/tppr-paper";
import { syncService } from "@/lib/cloud";
import { paperStore } from "@/lib/paper";

const ADMIN_FIELD_RE = /^\s*(?:[-*]\s*)?(?:\**\s*)?(?:name|surname|given\s+names?|class|teacher|examiner|supervisor|candidate(?:\s+(?:id|no\.?|number))?|student(?:\s+(?:id|no\.?|number))?|centre(?:\s+(?:id|no\.?|number))?|seat(?:\s+(?:id|no\.?|number))?|id(?:\s+(?:no\.?|number))?)(?:\s*\**)?\s*[:#._-]*\s*(?:[_\-\s.]*|[A-Za-z0-9][A-Za-z0-9\s._/-]{0,80})$/i;
const ADMIN_BOX_RE = /^(?:\|?\s*)?(?:[_\- ]{3,}\s*\|\s*){1,}[_\- ]{0,}\|?$/;
const OCR_RUBBISH_PHRASES = [
    "do not write in this area",
    "office use only",
    "answer booklet",
    "answers will be recorded",
    "place your answer",
];

function isOcrRubbishLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const low = trimmed.toLowerCase().replaceAll("**", "");
    return ADMIN_FIELD_RE.test(trimmed)
        || ADMIN_BOX_RE.test(trimmed)
        || OCR_RUBBISH_PHRASES.some((phrase) => low.includes(phrase));
}

function cleanText(text: string): string {
    return text
        .split("\n")
        .filter((line) => !isOcrRubbishLine(line))
        .join("\n")
        .trim();
}

function cleanBlocks(blocks?: ContentBlock[]): ContentBlock[] | undefined {
    if (!blocks) return blocks;
    const cleaned: ContentBlock[] = [];
    for (const block of blocks) {
        if (block.kind !== "text") {
            cleaned.push(block);
            continue;
        }
        const text = cleanText(block.text);
        if (text) cleaned.push({ ...block, text });
    }
    return cleaned.length ? cleaned : undefined;
}

function cleanAnswer(answer: string | QuestionAnswer | null | undefined) {
    if (typeof answer === "string") return cleanText(answer) || undefined;
    if (!answer || typeof answer !== "object") return answer;
    return {
        ...answer,
        content: cleanBlocks(answer.content),
        alternatives: answer.alternatives?.map((blocks) => cleanBlocks(blocks) ?? []),
    };
}

function cleanRubric(rubric?: QuestionRubric): QuestionRubric | undefined {
    if (!rubric) return rubric;
    return {
        ...rubric,
        criteria: rubric.criteria.map((criterion) => ({
            ...criterion,
            description: cleanBlocks(criterion.description) ?? [],
        })),
        notes: cleanBlocks(rubric.notes),
    };
}

function cleanPart(part: QuestionPart): QuestionPart {
    return {
        ...part,
        stimulus: cleanBlocks(part.stimulus),
        content: cleanBlocks(part.content),
        answer: cleanAnswer(part.answer),
        rubric: cleanRubric(part.rubric),
        guidelines: cleanBlocks(part.guidelines),
        parts: part.parts?.map(cleanPart),
    };
}

export function cleanImportedPaperContent(paper: Paper): Paper {
    return {
        ...paper,
        questions: paper.questions.map((question) => ({
            ...question,
            stimulus: cleanBlocks(question.stimulus),
            content: cleanBlocks(question.content),
            options: question.options?.map((option) => ({
                ...option,
                content: cleanBlocks(option.content) ?? [],
            })),
            parts: question.parts?.map(cleanPart),
            answer: cleanAnswer(question.answer),
            rubric: cleanRubric(question.rubric),
            guidelines: cleanBlocks(question.guidelines),
        })),
    };
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } | null {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) return null;
    const mimeType = match[1];
    try {
        const byteString = atob(match[2]);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
            bytes[i] = byteString.charCodeAt(i);
        }
        return { blob: new Blob([bytes], { type: mimeType }), mimeType };
    } catch {
        return null;
    }
}

async function storeDataUrlImagesAsAssets(
    paper: Paper,
): Promise<Paper> {
    async function resolveBlocks(blocks?: ContentBlock[]): Promise<ContentBlock[] | undefined> {
        if (!blocks) return blocks;
        const resolved: ContentBlock[] = [];
        for (const block of blocks) {
            if (block.kind === "image" && block.url.startsWith("data:")) {
                const converted = dataUrlToBlob(block.url);
                if (converted) {
                    const assetId = await paperStore.saveAsset(paper.id, converted.blob);
                    resolved.push({
                        ...block,
                        url: `asset://${assetId}`,
                        mime_type: block.mime_type || converted.mimeType,
                    });
                    continue;
                }
            }
            resolved.push(block);
        }
        return resolved;
    }

    async function resolvePart(part: QuestionPart): Promise<QuestionPart> {
        return {
            ...part,
            stimulus: await resolveBlocks(part.stimulus),
            content: await resolveBlocks(part.content),
            parts: part.parts ? await Promise.all(part.parts.map(resolvePart)) : undefined,
        };
    }

    const questions = await Promise.all(
        paper.questions.map(async (question) => ({
            ...question,
            stimulus: await resolveBlocks(question.stimulus),
            content: await resolveBlocks(question.content),
            options: question.options
                ? await Promise.all(
                    question.options.map(async (option) => ({
                        ...option,
                        content: (await resolveBlocks(option.content)) ?? [],
                    })),
                )
                : undefined,
            parts: question.parts ? await Promise.all(question.parts.map(resolvePart)) : undefined,
        })),
    );

    return { ...paper, questions };
}

function isValidTpprPaper(data: unknown): data is Paper {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
        typeof d.id === "string" &&
        typeof d.title === "string" &&
        typeof d.subject === "string" &&
        typeof d.visibility === "string" &&
        ["private", "public", "removed"].includes(d.visibility) &&
        typeof d.question_count === "number" &&
        typeof d.total_marks === "number" &&
        typeof d.created_at === "string" &&
        typeof d.updated_at === "string" &&
        Array.isArray(d.questions)
    );
}

export async function importPaperFromJsonFile(
    file: File,
    authorId: string,
    existingPapers: Pick<Paper, "title" | "subject">[] = [],
): Promise<Paper> {
    if (!file.name.toLowerCase().endsWith(".json")) {
        throw new Error("Please choose a .json file.");
    }

    let data: unknown;
    try {
        data = JSON.parse(await file.text());
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Could not parse the selected file.";
        throw new Error(`Invalid JSON: ${message}`, { cause: error });
    }

    return importPaperFromData(data, authorId, existingPapers);
}

export async function importPaperFromData(
    data: unknown,
    authorId: string,
    existingPapers: Pick<Paper, "title" | "subject">[] = [],
): Promise<Paper> {
    if (!isValidTpprPaper(data)) {
        throw new Error("Invalid file - does not match the TPPR paper format.");
    }

    const alreadyExists = existingPapers.some(
        (paper) => paper.title === data.title && paper.subject === data.subject,
    );
    if (alreadyExists) {
        throw new Error(`A paper called "${data.title}" already exists.`);
    }

    const now = new Date().toISOString();
    const imported: Paper = await storeDataUrlImagesAsAssets(
        cleanImportedPaperContent({
            ...data,
            id: crypto.randomUUID(),
            author_id: authorId,
            visibility: "private",
            created_at: now,
            updated_at: now,
            questions: data.questions.map((question, index) => ({
                ...question,
                number: index + 1,
                author_id: authorId,
                paper_id: "",
            })),
        }),
    );
    imported.questions = imported.questions.map((question) => ({
        ...question,
        paper_id: imported.id,
    }));

    await paperStore.savePaper(imported);
    await syncService.sync(imported);
    await syncService.flush();

    return imported;
}
