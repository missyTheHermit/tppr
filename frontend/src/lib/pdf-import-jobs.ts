import type { Paper } from "@/types/tppr-paper";
import {
    convertMistralOcrWithMistralChat,
    ocrPdfWithMistral,
} from "@/api/mistral-ocr";
import { importPaperFromData } from "@/lib/paper-import";
import { getStoredMistralApiKey } from "@/lib/mistral-settings";

/**
 * Lightweight localStorage-backed registry for background PDF import jobs.
 *
 * Each job tracks a Mistral OCR + chat conversion + local save pipeline.
 * The job runs entirely in the foreground (no service worker), but the
 * registry persists enough state that a fresh tab can detect and surface
 * in-flight or recently finished imports via toasts.
 *
 * Job lifecycle:  pending -> running -> done | error
 */

export type PdfImportJobStatus = "pending" | "running" | "done" | "error";

export interface PdfImportJob {
    id: string;
    fileName: string;
    status: PdfImportJobStatus;
    /** Human-readable status message for progress display. */
    message: string;
    /** ISO timestamp when the job was created. */
    createdAt: string;
    /** ISO timestamp of the last status update. */
    updatedAt: string;
    /** Paper id once import succeeded. */
    paperId?: string;
    /** Paper title once import succeeded. */
    paperTitle?: string;
    /** Error message if status === "error". */
    error?: string;
    /** Timestamped status lines for the live import output dialog. */
    logs?: string[];
}

const STORAGE_KEY = "tppr:pdf-import-jobs";
const MAX_JOBS = 20;

type Listener = () => void;
const listeners = new Set<Listener>();

function readJobs(): PdfImportJob[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as PdfImportJob[];
    } catch {
        return [];
    }
}

function writeJobs(jobs: PdfImportJob[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(-MAX_JOBS)));
    } catch {
        // Ignore quota errors - background import is best-effort.
    }
    listeners.forEach((listener) => listener());
}

export function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getJobs(): PdfImportJob[] {
    return readJobs();
}

export function getActiveJobs(): PdfImportJob[] {
    return readJobs().filter(
        (job) => job.status === "pending" || job.status === "running",
    );
}

function updateJob(
    id: string,
    patch: Partial<PdfImportJob>,
): PdfImportJob | undefined {
    const jobs = readJobs();
    const index = jobs.findIndex((job) => job.id === id);
    if (index === -1) return undefined;
    const next: PdfImportJob = {
        ...jobs[index],
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    jobs[index] = next;
    writeJobs(jobs);
    return next;
}

export function clearJob(id: string): void {
    const jobs = readJobs().filter((job) => job.id !== id);
    writeJobs(jobs);
}

function appendJobLog(id: string, message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] ${message}`;
    const current = readJobs().find((job) => job.id === id);
    updateJob(id, {
        message,
        logs: [...(current?.logs ?? []), line].slice(-100),
    });
}

export function clearFinishedJobs(): void {
    const jobs = readJobs().filter(
        (job) => job.status === "pending" || job.status === "running",
    );
    writeJobs(jobs);
}

export interface StartPdfImportOptions {
    userId: string;
    onCreated?: () => void;
}

/**
 * Start a background PDF import. Returns the job id immediately; the actual
 * OCR + conversion + save pipeline runs as a detached promise. Progress and
 * results are persisted to localStorage so they survive a tab close/reopen.
 *
 * Callers should not await this for UI flow - use the returned id to track
 * progress via getJobs()/subscribe().
 */
export function startPdfImport(
    file: File,
    { userId, onCreated }: StartPdfImportOptions,
): string | null {
    const apiKey = getStoredMistralApiKey();
    if (!apiKey) {
        return null;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job: PdfImportJob = {
        id,
        fileName: file.name,
        status: "pending",
        message: "Queued",
        logs: [`[${new Date().toLocaleTimeString()}] Queued ${file.name}`],
        createdAt: now,
        updatedAt: now,
    };
    writeJobs([...readJobs(), job]);

    // Detach the pipeline so it keeps running after the dialog closes.
    void runPdfImportPipeline(id, file, apiKey, userId, onCreated);

    return id;
}

async function runPdfImportPipeline(
    jobId: string,
    file: File,
    apiKey: string,
    userId: string,
    onCreated?: () => void,
): Promise<void> {
    updateJob(jobId, {
        status: "running",
        message: "Uploading PDF to Mistral OCR",
    });

    try {
        const ocrDocument = await ocrPdfWithMistral(file, {
            apiKey,
            onStatus: (message) => appendJobLog(jobId, message),
        });
        const converted = await convertMistralOcrWithMistralChat(ocrDocument, {
            apiKey,
            onStatus: (message) => appendJobLog(jobId, message),
        });
        appendJobLog(jobId, "Saving paper");
        const paper: Paper = await importPaperFromData(converted, userId);

        updateJob(jobId, {
            status: "done",
            message: "Import complete",
            paperId: paper.id,
            paperTitle: paper.title,
        });
        appendJobLog(jobId, `Import complete: ${paper.title}`);
        onCreated?.();
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Failed to import PDF";
        updateJob(jobId, { status: "error", message, error: message });
        appendJobLog(jobId, `Import failed: ${message}`);
    }
}