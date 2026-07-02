import { apiFetch } from "./client";
import type { PaperMeta } from "@/types/tppr-paper";

export interface PublicUser {
    user_id: string;
    username: string;
    avatar_url?: string | null;
}

export interface PresencePaper {
    id: string;
    title: string;
    subject: string;
    visibility: string;
}

export interface UserPresence {
    online: boolean;
    session_started_at?: string | null;
    last_seen_at?: string | null;
    seconds_on_site: number;
    active_paper?: PresencePaper | null;
    active_seconds: number;
}

export interface FriendRequest extends PublicUser {
    id: number;
    created_at?: string;
}

export interface Friend extends PublicUser {
    since?: string | null;
    presence?: UserPresence | null;
}

export interface LeaderboardEntry extends PublicUser {
    rank: number;
    attempts_count: number;
    papers_attempted: number;
    papers_completed: number;
    questions_answered: number;
    total_study_seconds: number;
    current_streak: number;
    longest_streak: number;
}

export interface UserProfile {
    user: PublicUser & {
        created_at?: string | null;
    };
    stats: {
        attempts_count: number;
        papers_attempted: number;
        papers_completed: number;
        questions_answered: number;
        total_study_seconds: number;
        reveal_count: number;
        current_streak: number;
        longest_streak: number;
        last_active_at?: string | null;
    };
    presence?: UserPresence | null;
    public_papers: PaperMeta[];
}

async function readError(res: Response, fallback: string): Promise<Error> {
    const body = await res.json().catch(() => null);
    return new Error(body?.message ?? fallback);
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
    if (!res.ok) throw await readError(res, fallback);
    return res.json() as Promise<T>;
}

export async function sendFriendRequest(
    username: string,
): Promise<{ message: string }> {
    const res = await apiFetch("/api/friends/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
    });
    return jsonOrThrow(res, "Failed to send friend request");
}

export async function listIncomingRequests(): Promise<{ requests: FriendRequest[] }> {
    const res = await apiFetch("/api/friends/requests/incoming");
    return jsonOrThrow(res, "Failed to load friend requests");
}

export async function listOutgoingRequests(): Promise<{ requests: FriendRequest[] }> {
    const res = await apiFetch("/api/friends/requests/outgoing");
    return jsonOrThrow(res, "Failed to load sent requests");
}

export async function acceptFriendRequest(id: number): Promise<{ message: string }> {
    const res = await apiFetch(`/api/friends/requests/${id}/accept`, {
        method: "POST",
    });
    return jsonOrThrow(res, "Failed to accept request");
}

export async function declineFriendRequest(id: number): Promise<{ message: string }> {
    const res = await apiFetch(`/api/friends/requests/${id}/decline`, {
        method: "POST",
    });
    return jsonOrThrow(res, "Failed to decline request");
}

export async function cancelFriendRequest(id: number): Promise<{ message: string }> {
    const res = await apiFetch(`/api/friends/requests/${id}`, {
        method: "DELETE",
    });
    return jsonOrThrow(res, "Failed to cancel request");
}

export async function listFriends(): Promise<{ friends: Friend[] }> {
    const res = await apiFetch("/api/friends");
    return jsonOrThrow(res, "Failed to load friends");
}

export async function removeFriend(userId: string): Promise<{ message: string }> {
    const res = await apiFetch(`/api/friends/${userId}`, { method: "DELETE" });
    return jsonOrThrow(res, "Failed to remove friend");
}

export async function getLeaderboard(
    scope?: "friends",
): Promise<{ entries: LeaderboardEntry[] }> {
    const qs = scope ? `?scope=${scope}` : "";
    const res = await apiFetch(`/api/leaderboard${qs}`);
    return jsonOrThrow(res, "Failed to load leaderboard");
}

export async function heartbeatPresence(paperId?: string | null): Promise<UserPresence> {
    const body = paperId === undefined ? {} : { paper_id: paperId };
    const res = await apiFetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return jsonOrThrow(res, "Failed to update presence");
}

export async function clearActivePaperPresence(): Promise<UserPresence> {
    const res = await apiFetch("/api/presence/active-paper", {
        method: "DELETE",
    });
    return jsonOrThrow(res, "Failed to clear presence");
}

export interface NotificationItem {
    id: string;
    type: "friend_request";
    content: string;
    /** Route to navigate to when the notification is clicked. */
    href: string;
    createdAt?: string;
}

export async function getNotifications(): Promise<NotificationItem[]> {
    try {
        const { requests } = await listIncomingRequests();
        return requests.map((req) => ({
            id: `friend-request-${req.id}`,
            type: "friend_request" as const,
            content: `${req.username} sent you a friend request`,
            href: "/friends",
            createdAt: req.created_at,
        }));
    } catch {
        return [];
    }
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
    const res = await apiFetch(`/api/users/${userId}/profile`);
    return jsonOrThrow(res, "Failed to load profile");
}
