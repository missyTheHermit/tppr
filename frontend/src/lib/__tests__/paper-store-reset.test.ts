import { describe, expect, it } from "vitest";

import { paperStore } from "../paper";
import { syncService } from "../cloud";

describe("account data reset helpers", () => {
    it("exposes a single helper for clearing all local papers and assets", () => {
        expect(paperStore.clearAll).toEqual(expect.any(Function));
    });

    it("cancels pending sync work before the reset deletes server data", () => {
        syncService.discardPending();
        expect(syncService.getStatus()).toBe("synced");
    });
});
