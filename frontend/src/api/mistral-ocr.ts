import type { Paper } from "@/types/tppr-paper";
import {
    MISTRAL_CHAT_MODEL,
    MISTRAL_OCR_MODEL,
} from "@/lib/mistral-settings";
import tpprImportPrompt from "@/../../docs/PROMPT.md?raw";

const MISTRAL_API_BASE = "https://api.mistral.ai/v1";

type StatusHandler = (status: string) => void;

interface MistralOcrOptions {
    apiKey: string;
    model?: string;
    onStatus?: StatusHandler;
}

interface MistralChatConversionOptions {
    apiKey: string;
    model?: string;
    onStatus?: StatusHandler;
    onChunk?: (text: string) => void;
}

interface OcrImageAsset {
    id: string;
    url: string;
    mime_type?: string;
    width?: number;
    height?: number;
}

async function readMistralError(res: Response, fallback: string): Promise<Error> {
    const body = await res.json().catch(() => null);
    const message = typeof body?.message === "string"
        ? body.message
        : typeof body?.detail === "string"
        ? body.detail
        : typeof body?.error?.message === "string"
        ? body.error.message
        : fallback;
    return new Error(message);
}

function compactMistralOcrForChat(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(compactMistralOcrForChat);

    const record = value as Record<string, unknown>;
    const compact: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
        if (key === "image_base64") continue;
        compact[key] = compactMistralOcrForChat(child);
    }
    return compact;
}

function imageMimeType(imageId: string, dataUrl: string): string | undefined {
    const dataMatch = /^data:([^;]+);/i.exec(dataUrl);
    if (dataMatch) return dataMatch[1];
    const lower = imageId.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    return undefined;
}

function collectOcrImages(ocrDocument: unknown): OcrImageAsset[] {
    if (!ocrDocument || typeof ocrDocument !== "object") return [];
    const pages = (ocrDocument as { pages?: unknown }).pages;
    if (!Array.isArray(pages)) return [];

    const assets: OcrImageAsset[] = [];
    for (const page of pages) {
        if (!page || typeof page !== "object") continue;
        const images = (page as { images?: unknown }).images;
        if (!Array.isArray(images)) continue;
        for (const image of images) {
            if (!image || typeof image !== "object") continue;
            const record = image as Record<string, unknown>;
            const id = typeof record.id === "string" ? record.id : "";
            const url = typeof record.image_base64 === "string"
                ? record.image_base64
                : "";
            if (!id || !url) continue;

            const topLeftX = typeof record.top_left_x === "number"
                ? record.top_left_x
                : undefined;
            const topLeftY = typeof record.top_left_y === "number"
                ? record.top_left_y
                : undefined;
            const bottomRightX = typeof record.bottom_right_x === "number"
                ? record.bottom_right_x
                : undefined;
            const bottomRightY = typeof record.bottom_right_y === "number"
                ? record.bottom_right_y
                : undefined;

            assets.push({
                id,
                url,
                mime_type: imageMimeType(id, url),
                width: topLeftX != null && bottomRightX != null
                    ? Math.max(1, bottomRightX - topLeftX)
                    : undefined,
                height: topLeftY != null && bottomRightY != null
                    ? Math.max(1, bottomRightY - topLeftY)
                    : undefined,
            });
        }
    }
    return assets;
}

function stripJsonFences(text: string): string {
    const trimmed = text.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return fence ? fence[1].trim() : trimmed;
}

function replaceImagePlaceholders(value: unknown, assets: OcrImageAsset[]): unknown {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        return value.map((item) => replaceImagePlaceholders(item, assets));
    }

    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
        next[key] = replaceImagePlaceholders(child, assets);
    }

    if (next.kind === "image" && typeof next.url === "string") {
        const placeholder = /^IMAGE_PLACEHOLDER_(\d+)(?:\.[A-Za-z0-9]+)?$/i
            .exec(next.url);
        const asset = placeholder
            ? assets[Number(placeholder[1]) - 1]
            : assets.find((candidate) => candidate.id === next.url);
        if (asset) {
            next.url = asset.url;
            if (asset.mime_type) next.mime_type = asset.mime_type;
            if (!next.width && asset.width) next.width = asset.width;
            if (!next.height && asset.height) next.height = asset.height;
        }
    }

    return next;
}

async function mistralFetch(
    path: string,
    apiKey: string,
    init: RequestInit = {},
): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    return fetch(`${MISTRAL_API_BASE}${path}`, { ...init, headers });
}

function getUploadedFileId(data: unknown): string {
    if (
        data &&
        typeof data === "object" &&
        typeof (data as { id?: unknown }).id === "string"
    ) {
        return (data as { id: string }).id;
    }
    throw new Error("Mistral did not return an uploaded file id.");
}

function getSignedUrl(data: unknown): string {
    if (!data || typeof data !== "object") {
        throw new Error("Mistral did not return a signed file URL.");
    }
    const record = data as { url?: unknown; signed_url?: unknown };
    if (typeof record.url === "string") return record.url;
    if (typeof record.signed_url === "string") return record.signed_url;
    throw new Error("Mistral did not return a signed file URL.");
}

export async function ocrPdfWithMistral(
    file: File,
    { apiKey, model = MISTRAL_OCR_MODEL, onStatus }: MistralOcrOptions,
): Promise<unknown> {
    if (file.type && file.type !== "application/pdf") {
        throw new Error("Please choose a PDF file.");
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Please choose a .pdf file.");
    }
    if (!apiKey.trim()) {
        throw new Error("Add your Mistral API key in Settings first.");
    }

    let fileId: string | null = null;

    try {
        onStatus?.("Uploading PDF to Mistral OCR");
        const form = new FormData();
        form.set("purpose", "ocr");
        form.set("visibility", "user");
        form.set("expiry", "1");
        form.set("file", file);

        const uploadRes = await mistralFetch("/files", apiKey, {
            method: "POST",
            body: form,
        });
        if (!uploadRes.ok) {
            throw await readMistralError(uploadRes, "Failed to upload PDF to Mistral.");
        }
        fileId = getUploadedFileId(await uploadRes.json());

        onStatus?.("Preparing OCR request");
        const urlRes = await mistralFetch(
            `/files/${encodeURIComponent(fileId)}/url?expiry=1`,
            apiKey,
        );
        if (!urlRes.ok) {
            throw await readMistralError(urlRes, "Failed to create a Mistral file URL.");
        }
        const signedUrl = getSignedUrl(await urlRes.json());

        onStatus?.("Running Mistral OCR");
        const ocrRes = await mistralFetch("/ocr", apiKey, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                document: {
                    type: "document_url",
                    document_url: signedUrl,
                },
                include_image_base64: true,
            }),
        });
        if (!ocrRes.ok) {
            throw await readMistralError(ocrRes, "Mistral OCR failed.");
        }

        return ocrRes.json();
    } finally {
        if (fileId) {
            void mistralFetch(`/files/${encodeURIComponent(fileId)}`, apiKey, {
                method: "DELETE",
            }).catch(() => undefined);
        }
    }
}

export async function convertMistralOcrWithMistralChat(
    ocrDocument: unknown,
    {
        apiKey,
        model = MISTRAL_CHAT_MODEL,
        onStatus,
        onChunk,
    }: MistralChatConversionOptions,
): Promise<Paper> {
    if (!apiKey.trim()) {
        throw new Error("Add your Mistral API key in Settings first.");
    }

    const imageAssets = collectOcrImages(ocrDocument);
    const compactOcrDocument = compactMistralOcrForChat(ocrDocument);

    onStatus?.("Converting OCR with Mistral chat");
    const chatRes = await mistralFetch("/chat/completions", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            temperature: 0.1,
            response_format: { type: "json_object" },
            stream: true,
            messages: [
                {
                    role: "system",
                    content: tpprImportPrompt,
                },
                {
                    role: "user",
                    content: [
                        "Convert this Mistral OCR JSON output into TPPR JSON.",
                        "The OCR image_base64 values were removed from this chat payload to keep it compact.",
                        "Use IMAGE_PLACEHOLDER_1, IMAGE_PLACEHOLDER_2, etc. for images in the order they appear in the OCR pages.",
                        JSON.stringify(compactOcrDocument),
                    ].join("\n\n"),
                },
            ],
        }),
    });
    if (!chatRes.ok) {
        throw await readMistralError(chatRes, "Mistral chat conversion failed.");
    }

    if (!chatRes.body) {
        throw new Error("Mistral chat returned no response body.");
    }

    onStatus?.("Streaming Mistral conversion");
    const reader = chatRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let chatText = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (!trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta) {
                    chatText += delta;
                    onChunk?.(delta);
                }
            } catch {
                // partial JSON, skip
            }
        }
    }

    onStatus?.("Reading Mistral conversion");
    const stripped = stripJsonFences(chatText);
    let converted: Paper;
    try {
        converted = JSON.parse(stripped) as Paper;
    } catch (parseErr) {
        // Try to extract the first JSON object from the text as a fallback
        const jsonMatch = stripped.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                converted = JSON.parse(jsonMatch[0]) as Paper;
            } catch {
                throw new Error(
                    `Mistral returned invalid JSON: ${
                        parseErr instanceof Error ? parseErr.message : "parse error"
                    }`,
                );
            }
        } else {
            throw new Error(
                `Mistral returned invalid JSON: ${
                    parseErr instanceof Error ? parseErr.message : "parse error"
                }`,
            );
        }
    }
    return replaceImagePlaceholders(converted, imageAssets) as Paper;
}
