import type { PapersListResponse } from "@/types/responses";
import type { CourseLevel, Paper, PaperSource, Question, Visibility } from "@/types/tppr-paper";

export interface StoredAsset {
    id: string;
    paperId: string;
    blob: Blob;
    mimeType: string;
}

export interface NewPaperInput {
    title: string;
    subject: string;
    syllabus_id?: string | null;
    course_level?: CourseLevel | null;
    year?: number | null;
    source?: PaperSource | null;
    school?: string | null;
    topics?: string[];
    outcomes?: string[];
    visibility: Visibility;
    duration_minutes?: number | null;
}

const DB_NAME = "tppr";
const DB_VERSION = 1;

class PaperStore {
    private dbPromise: Promise<IDBDatabase> | null = null;

    private open(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("papers")) {
                    db.createObjectStore("papers", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("assets")) {
                    const assets = db.createObjectStore("assets", { keyPath: "id" });
                    assets.createIndex("by-paper", "paperId");
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return this.dbPromise;
    }

    private async run<T>(
        store: string,
        mode: IDBTransactionMode,
        fn: (s: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, mode);
            const req = fn(tx.objectStore(store));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    savePaper(paper: Paper): Promise<IDBValidKey> {
        return this.run("papers", "readwrite", (s) => s.put(paper));
    }

    getPaper(id: string): Promise<Paper | undefined> {
        return this.run("papers", "readonly", (s) => s.get(id));
    }

    listPapers(): Promise<Paper[]> {
        return this.run("papers", "readonly", (s) => s.getAll());
    }

    /** Saves the asset internally inside the paper storage and returns the id */
    saveAsset(paperId: string, file: Blob, id: string = crypto.randomUUID()): Promise<string> {
        const asset: StoredAsset = { id, paperId, blob: file, mimeType: file.type };
        return this.run("assets", "readwrite", (s) => s.put(asset)).then(() => id);
    }

    getAsset(id: string): Promise<StoredAsset | undefined> {
        return this.run("assets", "readonly", (s) => s.get(id));
    }

    async deletePaper(id: string): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(["papers", "assets"], "readwrite");
            tx.objectStore("papers").delete(id);
            const index = tx.objectStore("assets").index("by-paper");
            index.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
                const cursor = (e.target as IDBRequest<IDBCursor>).result;
                if (cursor) {
                    tx.objectStore("assets").delete(cursor.primaryKey);
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async clearAll(): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(["papers", "assets"], "readwrite");
            tx.objectStore("papers").clear();
            tx.objectStore("assets").clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

export const paperStore = new PaperStore();

export async function createLocalPaper(input: NewPaperInput, authorId: string): Promise<Paper> {
    const now = new Date().toISOString();
    const paper: Paper = {
        id: crypto.randomUUID(),
        title: input.title,
        author_id: authorId,
        subject: input.subject,
        syllabus_id: input.syllabus_id || undefined,
        course_level: input.course_level ?? undefined,
        year: input.year ?? undefined,
        source: input.source ?? undefined,
        school: input.school || undefined,
        topics: input.topics ?? [],
        outcomes: input.outcomes ?? [],
        visibility: input.visibility,
        question_count: 0,
        total_marks: 0,
        duration_minutes: input.duration_minutes ?? undefined,
        created_at: now,
        updated_at: now,
        questions: [],
    };
    await paperStore.savePaper(paper);
    return paper;
}

export function createQuestion(paper: Paper): Question {
    const now = new Date().toISOString();
    return {
        id: crypto.randomUUID(),
        paper_id: paper.id,
        author_id: paper.author_id,
        number: paper.questions.length + 1,
        type: "short_answer",
        marks: 1,
        content: [],
        created_at: now,
        updated_at: now,
    };
}

/** Recompute derived fields + bump updated_at. */
export function withRecalculatedTotals(paper: Paper): Paper {
    return {
        ...paper,
        question_count: paper.questions.length,
        total_marks: paper.questions.reduce((s, q) => s + q.marks, 0),
        updated_at: new Date().toISOString(),
    };
}

// ------- SEARCHING -------

export interface SearchFilters {
    q?: string;
    subject?: string;
    source?: string;
    course_level?: string;
    year?: string;
    verified?: string;
    school?: string;
    topic?: string;
    outcome?: string;
    min_marks?: string;
    max_marks?: string;
    min_duration?: string;
    max_duration?: string;
    page?: number;
    per_page?: number;
}

export async function searchPapers(filters: SearchFilters = {}): Promise<PapersListResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const res = await fetch(`/api/papers/search?${params}`, { credentials: "include" });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
}
