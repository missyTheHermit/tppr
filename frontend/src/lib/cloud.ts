import type { Paper } from "@/types/tppr-paper";
import { apiFetch } from "@/api/client";
import { paperStore } from "./paper";

export type SyncStatus = "synced" | "syncing" | "pending" | "offline";

function collectAssetIds(value: unknown, ids = new Set<string>()): Set<string> {
    if (!value || typeof value !== "object") return ids;

    if (Array.isArray(value)) {
        for (const item of value) collectAssetIds(item, ids);
        return ids;
    }

    const record = value as Record<string, unknown>;
    if (
        record.kind === "image" &&
        typeof record.url === "string" &&
        record.url.startsWith("asset://")
    ) {
        ids.add(record.url.slice("asset://".length));
    }

    for (const child of Object.values(record)) {
        collectAssetIds(child, ids);
    }

    return ids;
}

export class SyncService {
    private timeout: ReturnType<typeof setTimeout> | null = null;
    private pending: Paper | null = null;
    private pendingVersion = 0;
    private status: SyncStatus = "synced";
    private listeners = new Set<(s: SyncStatus) => void>();

    getStatus() {
        return this.status;
    }

    subscribe(fn: (s: SyncStatus) => void) {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    }

    private setStatus(s: SyncStatus) {
        if (s === this.status) return;
        this.status = s;
        this.listeners.forEach((fn) => fn(s));
    }

    private async saveServerPaper(
        res: Response,
        pushedVersion: number,
    ): Promise<void> {
        if (this.pendingVersion !== pushedVersion) return;
        const saved = await res.json() as Paper;
        if (this.pendingVersion !== pushedVersion) return;
        await paperStore.savePaper(saved);
    }

    /** Uploads all assets in a paper */
    private async uploadAssets(paper: Paper): Promise<void> {
        const assetIds = collectAssetIds(paper);
        for (const assetId of assetIds) {
            const asset = await paperStore.getAsset(assetId).catch(() =>
                undefined
            );
            if (!asset) continue;

            const formData = new FormData();
            formData.set("asset_id", asset.id);
            formData.set(
                "file",
                new File([asset.blob], asset.id, {
                    type: asset.mimeType || asset.blob.type ||
                        "application/octet-stream",
                }),
            );

            const res = await apiFetch(`/api/papers/${paper.id}/assets`, {
                method: "POST",
                body: formData,
            });
            if (!res.ok) throw new Error(`Asset upload failed: ${res.status}`);
        }
    }

    /** Uploads only a single asset from a paper */
    async uploadAsset(paperId: string, assetId: string): Promise<void> {
        const asset = await paperStore.getAsset(assetId).catch(() => undefined);
        if (!asset) return;

        const formData = new FormData();
        formData.set("asset_id", asset.id);
        formData.set(
            "file",
            new File([asset.blob], asset.id, {
                type: asset.mimeType || asset.blob.type ||
                    "application/octet-stream",
            }),
        );

        const res = await apiFetch(`/api/papers/${paperId}/assets`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) console.warn(`Asset upload failed: ${res.status}`);
    }

    private async pushToServer(paper: Paper, version: number): Promise<void> {
        this.setStatus("syncing");
        const res = await apiFetch(`/api/papers/${paper.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(paper),
        });

        if (res.status === 404) {
            const createRes = await apiFetch("/api/papers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(paper),
            });
            if (!createRes.ok) {
                let detail = `Create failed: ${createRes.status}`;
                try {
                    const body = await createRes.json();
                    if (body?.message) detail = `Create failed: ${body.message}`;
                } catch { /* not JSON */ }
                throw new Error(detail);
            }
            await this.saveServerPaper(createRes, version);
        } else if (!res.ok) {
            throw new Error(`Sync failed: ${res.status}`);
        } else {
            await this.saveServerPaper(res, version);
        }
        await this.uploadAssets(paper);
        this.setStatus(
            this.pendingVersion === version ? "synced" : "pending",
        );
    }

    async sync(paper: Paper): Promise<void> {
        void paperStore.savePaper(paper).catch((e) => {
            console.warn(e);
            this.setStatus("offline");
        });
        this.pending = paper;
        this.pendingVersion += 1;
        this.setStatus("pending");

        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = setTimeout(async () => {
            if (!this.pending) return;
            const version = this.pendingVersion;
            const toPush = this.pending;
            try {
                await this.pushToServer(toPush, version);
                if (this.pendingVersion === version) {
                    this.pending = null;
                }
            } catch (e) {
                console.warn(e);
                this.setStatus("offline");
            }
        }, 1500);
    }

    async flush(): Promise<void> {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        if (this.pending) {
            const version = this.pendingVersion;
            const toPush = this.pending;
            try {
                await this.pushToServer(toPush, version);
                if (this.pendingVersion === version) {
                    this.pending = null;
                }
            } catch (e) {
                this.setStatus("offline");
                throw e;
            }
        }
    }

    discardPending(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        this.pending = null;
        this.pendingVersion += 1;
        this.setStatus("synced");
    }

    async publish(paperId: string): Promise<void> {
        const paper = await paperStore.getPaper(paperId);
        if (!paper) throw new Error("Paper not found locally");
        this.setStatus("syncing");
        const res = await apiFetch(`/api/papers/${paperId}/publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(paper),
        });
        if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
        await this.uploadAssets(paper);
        this.setStatus("synced");
    }

    async unpublish(paperId: string): Promise<void> {
        this.setStatus("syncing");
        const res = await apiFetch(`/api/papers/${paperId}/publish`, {
            method: "DELETE",
        });
        if (!res.ok) throw new Error(`Unpublish failed: ${res.status}`);
        this.setStatus("synced");
    }
}

export const syncService = new SyncService();
