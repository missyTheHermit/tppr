import { supabase } from "@/lib/supabase";

export async function apiFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
) {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = new Headers(init.headers);

    if (session?.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
    }

    return fetch(input, { ...init, headers });
}

/**
 * Return an avatar URL with a stable cache-busting query parameter derived
 * from the cached user timestamp. If the avatar URL hasn't changed the
 * parameter stays constant, so the browser's HTTP cache serves the image
 * instantly without refetching on focus loss / re-renders.
 */
export function cacheAvatarUrl(
    url: string | null | undefined,
): string | undefined {
    if (!url) return undefined;
    try {
        const raw = localStorage.getItem("tppr:cached-user");
        if (!raw) return url;
        const parsed = JSON.parse(raw) as { timestamp?: number };
        const ts = parsed.timestamp ?? 0;
        if (!ts) return url;
        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}v=${ts}`;
    } catch {
        return url;
    }
}
