import type { PaperMeta } from "@/types/tppr-paper";
import { apiFetch } from "./client";

export interface StarredPaper {
    paper: PaperMeta;
    starred_at: string | null;
}

export interface StarsResponse {
    stars: StarredPaper[];
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? fallback);
    }
    return res.json() as Promise<T>;
}

export function getStarredPapers(): Promise<StarsResponse> {
    return apiFetch("/api/stars").then((r) =>
        jsonOrThrow(r, "Failed to load starred papers"),
    );
}

export function getStarStatus(paperId: string): Promise<boolean> {
    return apiFetch(`/api/papers/${paperId}/star`).then(async (r) => {
        if (!r.ok) return false;
        const data = await r.json();
        return Boolean(data.starred);
    });
}

export function setPaperStarred(
    paperId: string,
    starred: boolean,
): Promise<boolean> {
    return apiFetch(`/api/papers/${paperId}/star`, {
        method: starred ? "POST" : "DELETE",
    }).then(async (r) => {
        const data = await jsonOrThrow<{ starred: boolean }>(
            r,
            starred ? "Failed to star paper" : "Failed to unstar paper",
        );
        return Boolean(data.starred);
    });
}

export async function getStarCount(paperId: string): Promise<number> {
    const res = await apiFetch(`/api/papers/${paperId}/star-count`);
    if (!res.ok) return 0;
    const data = await res.json().catch(() => null);
    return Number(data?.star_count ?? 0);
}
