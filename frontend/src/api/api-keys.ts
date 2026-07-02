import { apiFetch } from "./client";

export interface ApiKey {
  id: number;
  name: string | null;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface CreatedApiKey {
  key: string;
  name: string | null;
  prefix: string;
  created_at: string;
}

export async function createApiKey(
  name?: string,
): Promise<CreatedApiKey> {
  const res = await apiFetch("/api/account/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? "Failed to create API key");
  }
  return res.json();
}

export async function listApiKeys(): Promise<{ keys: ApiKey[] }> {
  const res = await apiFetch("/api/account/api-keys");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? "Failed to list API keys");
  }
  return res.json();
}

export async function revokeApiKey(
  keyId: number,
): Promise<{ message: string }> {
  const res = await apiFetch(`/api/account/api-keys/${keyId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? "Failed to revoke API key");
  }
  return res.json();
}
