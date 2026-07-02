import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/api/auth";
import { supabase } from "@/lib/supabase";
import NavBar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Key, Copy, Plus, Trash2, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { syncService } from "@/lib/cloud";
import { paperStore } from "@/lib/paper";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKey,
} from "@/api/api-keys";
import {
    getStoredMistralApiKey,
    setStoredMistralApiKey,
} from "@/lib/mistral-settings";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Remove all tppr-related keys from localStorage and clear any IndexedDB
 * databases we may have created. Keys are removed if they start with
 * `tppr`, start with `hasSeen`, or contain `tppr` anywhere in the name.
 */
async function clearTpprLocalStorage() {
    // localStorage keys
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (
            key.startsWith("tppr") ||
            key.startsWith("hasSeen") ||
            key.includes("tppr")
        ) {
            toRemove.push(key);
        }
    }
    for (const key of toRemove) localStorage.removeItem(key);

    // IndexedDB — best-effort wipe of any tppr-prefixed databases.
    try {
        await paperStore.clearAll();
    } catch {
        /* ignore, the database may not exist yet */
    }

    if (typeof indexedDB !== "undefined" && indexedDB.databases) {
        const dbs = await indexedDB.databases().catch(() => []);
        await Promise.all(
            dbs
                .filter((db) => db.name && db.name.includes("tppr"))
                .map((db) =>
                    new Promise<void>((resolve) => {
                        const req = indexedDB.deleteDatabase(db.name!);
                        req.onsuccess = () => resolve();
                        req.onerror = () => resolve();
                        req.onblocked = () => resolve();
                    })
                ),
        );
    }
}

export default function Settings() {
    const { user, loading: authLoading, logout, refreshUser } = useAuth();
    const navigate = useNavigate();

    const [username, setUsername] = useState(user?.username ?? "");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [mistralApiKey, setMistralApiKey] = useState(() =>
        getStoredMistralApiKey()
    );
    const [avatarSaving, setAvatarSaving] = useState(false);
    const [resetDataOpen, setResetDataOpen] = useState(false);
    const [resettingData, setResettingData] = useState(false);
    const avatarInputRef = useRef<HTMLInputElement>(null);

    const [mfaFactors, setMfaFactors] = useState<
        { id: string; friendlyName?: string }[]
    >([]);
    const [enrolling, setEnrolling] = useState(false);
    const [enrollData, setEnrollData] = useState<
        { id: string; qr: string; secret: string } | null
    >(null);
    const [verifyCode, setVerifyCode] = useState("");

    // API Keys
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [apiKeysLoading, setApiKeysLoading] = useState(true);
    const [generateOpen, setGenerateOpen] = useState(false);
    const [newKeyName, setNewKeyName] = useState("");
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        supabase.auth.mfa.listFactors().then(({ data }) => {
            if (data?.totp) setMfaFactors(data.totp);
        });
    }, []);

    useEffect(() => {
        if (!authLoading && !user) {
            navigate("/login?redirect=/settings", { replace: true });
        }
    }, [user, authLoading, navigate]);

    useEffect(() => {
        if (!user) return;
        setApiKeysLoading(true);
        listApiKeys()
            .then(({ keys }) => setApiKeys(keys))
            .catch(() => toast.error("Failed to load API keys"))
            .finally(() => setApiKeysLoading(false));
    }, [user]);

    if (authLoading) return null;
    if (!user) return null;

    async function handleEnroll2FA() {
        setEnrolling(true);
        const { data, error } = await supabase.auth.mfa.enroll({
            factorType: "totp",
            friendlyName: "Authenticator App",
        });
        if (error) {
            toast.error(error.message);
            setEnrolling(false);
            return;
        }
        setEnrollData({
            id: data.id,
            qr: data.totp.qr_code,
            secret: data.totp.secret,
        });
    }

    async function handleVerifyEnrollment() {
        if (!enrollData) return;
        const { data: challenge, error: challengeErr } = await supabase.auth.mfa
            .challenge({
                factorId: enrollData.id,
            });
        if (challengeErr) {
            toast.error(challengeErr.message);
            return;
        }

        const { error: verifyErr } = await supabase.auth.mfa.verify({
            factorId: enrollData.id,
            challengeId: challenge.id,
            code: verifyCode,
        });
        if (verifyErr) {
            toast.error(verifyErr.message);
            return;
        }

        toast.success("2FA enabled successfully");
        setEnrolling(false);
        setEnrollData(null);
        setVerifyCode("");

        const { data } = await supabase.auth.mfa.listFactors();
        if (data?.totp) setMfaFactors(data.totp);
    }

    async function handleUnenroll(factorId: string) {
        if (!confirm("Disable two-factor authentication?")) return;
        const { error } = await supabase.auth.mfa.unenroll({ factorId });
        if (error) {
            toast.error(error.message);
            return;
        }
        toast.success("2FA disabled");
        setMfaFactors((prev) => prev.filter((f) => f.id !== factorId));
    }

    async function handleUpdateUsername() {
        const trimmed = username.trim();
        if (!trimmed) {
            toast.error("Username is required");
            return;
        }
        const { error } = await supabase.auth.updateUser({
            data: { username: trimmed },
        });
        if (error) {
            toast.error(error.message);
        } else {
            const form = new FormData();
            form.set("username", trimmed);
            const res = await apiFetch("/api/account/username", {
                method: "PUT",
                body: form,
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                toast.error(body?.message ?? "Failed to update username");
                return;
            }
            await refreshUser();
            toast.success("Username updated");
        }
    }

    async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
            toast.error("Please choose a PNG, JPEG, or WebP image");
            return;
        }
        if (file.size > 1_000_000) {
            toast.error("Image is too large (max 1 MB)");
            return;
        }

        setAvatarSaving(true);
        try {
            const form = new FormData();
            form.append("file", file);
            const res = await apiFetch("/api/account/avatar", {
                method: "PUT",
                body: form,
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                toast.error(body?.message ?? "Failed to update avatar");
                return;
            }
            await refreshUser();
            toast.success("Avatar updated");
        } catch {
            toast.error("Failed to update avatar");
        } finally {
            setAvatarSaving(false);
        }
    }

    async function handleRemoveAvatar() {
        setAvatarSaving(true);
        try {
            const res = await apiFetch("/api/account/avatar", {
                method: "DELETE",
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                toast.error(body?.message ?? "Failed to remove avatar");
                return;
            }
            await refreshUser();
            toast.success("Avatar removed");
        } catch {
            toast.error("Failed to remove avatar");
        } finally {
            setAvatarSaving(false);
        }
    }

    async function handleChangePassword() {
        if (newPassword !== confirmPassword) {
            toast.error("Passwords do not match");
            return;
        }
        if (newPassword.length < 6) {
            toast.error("Password must be at least 6 characters");
            return;
        }
        const { error } = await supabase.auth.updateUser({
            password: newPassword,
        });
        if (error) {
            toast.error(error.message);
        } else {
            toast.success("Password updated");
            setNewPassword("");
            setConfirmPassword("");
        }
    }

    function handleSaveMistralApiKey() {
        setStoredMistralApiKey(mistralApiKey);
        setMistralApiKey(getStoredMistralApiKey());
        toast.success(
            mistralApiKey.trim()
                ? "Mistral API key saved in this browser"
                : "Mistral API key removed",
        );
    }

    async function handleResetData() {
        setResettingData(true);
        try {
            const res = await apiFetch("/api/account/data", {
                method: "DELETE",
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                toast.error(body?.message ?? "Failed to reset account data");
                return;
            }
            syncService.discardPending();
            await clearTpprLocalStorage();
            toast.success("Account data reset");
            setResetDataOpen(false);
            // Refresh the page so all in-memory state is wiped cleanly.
            window.location.href = "/login";
        } catch {
            toast.error("Failed to reset account data");
        } finally {
            setResettingData(false);
        }
    }

    async function handleDeleteAccount() {
        const res = await apiFetch("/api/account", { method: "DELETE" });
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            toast.error(body?.message ?? "Failed to delete account");
            return;
        }
        await supabase.auth.signOut();
        toast("Well, to each their own. Have a good one!");
        navigate("/", { replace: true });
    }

    async function handleGenerateKey() {
        setGenerating(true);
        try {
            const result = await createApiKey(newKeyName.trim() || undefined);
            setGeneratedKey(result.key);
            toast.success("API key generated");
            // Refresh the list
            const { keys } = await listApiKeys();
            setApiKeys(keys);
        } catch (err: any) {
            toast.error(err?.message ?? "Failed to generate API key");
        } finally {
            setGenerating(false);
        }
    }

    async function handleRevokeKey(keyId: number) {
        try {
            await revokeApiKey(keyId);
            toast.success("API key revoked");
            setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
        } catch (err: any) {
            toast.error(err?.message ?? "Failed to revoke API key");
        }
    }

    function handleCopyKey() {
        if (!generatedKey) return;
        navigator.clipboard.writeText(generatedKey).then(
            () => toast.success("Key copied to clipboard"),
            () => toast.error("Failed to copy"),
        );
    }

    function closeGenerateDialog() {
        setGenerateOpen(false);
        setNewKeyName("");
        setGeneratedKey(null);
    }

    function formatDate(dateStr: string | null) {
        if (!dateStr) return "Never";
        return new Date(dateStr).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    return (
        <>
            <NavBar />
            <main className="mx-auto w-full max-w-2xl px-6 py-10 space-y-6">
                <h1 className="text-2xl font-bold">Settings</h1>

                {/* Avatar */}
                <Card>
                    <CardHeader>
                        <CardTitle>Avatar</CardTitle>
                        <CardDescription>
                            Shown next to your name across the site. PNG, JPEG,
                            or WebP up to 1 MB.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-4">
                            <Avatar className="size-16">
                                <AvatarImage
                                    src={user.avatar_url}
                                    alt={user.username}
                                />
                                <AvatarFallback className="text-lg">
                                    {user.username?.slice(0, 2).toUpperCase() ??
                                        "U"}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-wrap gap-2">
                                <input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={handleAvatarChange}
                                />
                                <Button
                                    size="sm"
                                    disabled={avatarSaving}
                                    onClick={() =>
                                        avatarInputRef.current?.click()}
                                >
                                    {user.avatar_url
                                        ? "Change avatar"
                                        : "Upload avatar"}
                                </Button>
                                {user.avatar_url && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={avatarSaving}
                                        onClick={handleRemoveAvatar}
                                    >
                                        Remove
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Profile */}
                <Card>
                    <CardHeader>
                        <CardTitle>Profile</CardTitle>
                        <CardDescription>
                            Your public account information.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <FieldGroup>
                            <Field>
                                <FieldLabel>Email</FieldLabel>
                                <Input value={user.email} disabled />
                            </Field>
                            <Field>
                                <FieldLabel>Username</FieldLabel>
                                <Input
                                    value={username}
                                    onChange={(e) =>
                                        setUsername(e.target.value)}
                                />
                            </Field>
                            <Button onClick={handleUpdateUsername} size="sm">
                                Save Username
                            </Button>
                        </FieldGroup>
                    </CardContent>
                </Card>

                {/* Password */}
                <Card>
                    <CardHeader>
                        <CardTitle>Change Password</CardTitle>
                        <CardDescription>
                            Update your account password.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <FieldGroup>
                            <Field>
                                <FieldLabel>New Password</FieldLabel>
                                <Input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) =>
                                        setNewPassword(e.target.value)}
                                />
                            </Field>
                            <Field>
                                <FieldLabel>Confirm Password</FieldLabel>
                                <Input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) =>
                                        setConfirmPassword(e.target.value)}
                                />
                            </Field>
                            <Button onClick={handleChangePassword} size="sm">
                                Update Password
                            </Button>
                        </FieldGroup>
                    </CardContent>
                </Card>

                {/* OCR */}
                <Card>
                    <CardHeader>
                        <CardTitle>Mistral OCR</CardTitle>
                        <CardDescription>
                            Used for importing PDFs. Your API key is saved in
                            this browser and is not stored by tppr.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <FieldGroup>
                            <Field>
                                <FieldLabel htmlFor="mistral-api-key">
                                    Mistral API Key
                                </FieldLabel>
                                <Input
                                    id="mistral-api-key"
                                    type="password"
                                    value={mistralApiKey}
                                    onChange={(e) =>
                                        setMistralApiKey(e.target.value)}
                                    placeholder="mistral API key"
                                    autoComplete="off"
                                />
                            </Field>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    onClick={handleSaveMistralApiKey}
                                    size="sm"
                                >
                                    Save API Key
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        setMistralApiKey("");
                                        setStoredMistralApiKey("");
                                        toast.success("Mistral API key removed");
                                    }}
                                    size="sm"
                                >
                                    Remove
                                </Button>
                            </div>
                        </FieldGroup>
                    </CardContent>
                </Card>

                {/* API Keys */}
                <Card>
                    <CardHeader>
                        <CardTitle>API Keys</CardTitle>
                        <CardDescription>
                            Generate keys to authenticate with the tppr API.
                            Keep them safe — you won't see the full key again.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <Dialog
                                open={generateOpen}
                                onOpenChange={(open) => {
                                    if (!open) closeGenerateDialog();
                                    else setGenerateOpen(true);
                                }}
                            >
                                <DialogTrigger asChild>
                                    <Button size="sm">
                                        <Plus className="mr-1.5 size-4" />
                                        Generate New Key
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>
                                            Generate API Key
                                        </DialogTitle>
                                        <DialogDescription>
                                            Give your key a name to remember
                                            what it's for.
                                        </DialogDescription>
                                    </DialogHeader>
                                    {!generatedKey ? (
                                        <div className="space-y-4">
                                            <Field>
                                                <FieldLabel>
                                                    Key name (optional)
                                                </FieldLabel>
                                                <Input
                                                    value={newKeyName}
                                                    onChange={(e) =>
                                                        setNewKeyName(
                                                            e.target.value,
                                                        )}
                                                    placeholder="e.g. My CLI tool"
                                                />
                                            </Field>
                                            <DialogFooter>
                                                <DialogClose asChild>
                                                    <Button
                                                        variant="outline"
                                                        disabled={generating}
                                                    >
                                                        Cancel
                                                    </Button>
                                                </DialogClose>
                                                <Button
                                                    onClick={handleGenerateKey}
                                                    disabled={generating}
                                                >
                                                    {generating
                                                        ? "Generating..."
                                                        : "Generate"}
                                                </Button>
                                            </DialogFooter>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                                <AlertTriangle className="size-4" />
                                                <p className="text-sm font-medium">
                                                    This is the only time you
                                                    will see this key. Copy it
                                                    now.
                                                </p>
                                            </div>
                                            <Field>
                                                <FieldLabel>
                                                    Your API Key
                                                </FieldLabel>
                                                <div className="flex gap-2">
                                                    <Input
                                                        value={generatedKey}
                                                        readOnly
                                                        className="font-mono text-xs"
                                                    />
                                                    <Button
                                                        size="icon"
                                                        variant="outline"
                                                        onClick={handleCopyKey}
                                                        title="Copy to clipboard"
                                                    >
                                                        <Copy className="size-4" />
                                                    </Button>
                                                </div>
                                            </Field>
                                            <DialogFooter>
                                                <Button
                                                    variant="outline"
                                                    onClick={
                                                        closeGenerateDialog
                                                    }
                                                >
                                                    Done
                                                </Button>
                                            </DialogFooter>
                                        </div>
                                    )}
                                </DialogContent>
                            </Dialog>

                            {apiKeysLoading ? (
                                <p className="text-sm text-muted-foreground">
                                    Loading...
                                </p>
                            ) : apiKeys.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No API keys yet. Generate one to get
                                    started.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {apiKeys.map((key) => (
                                        <div
                                            key={key.id}
                                            className="flex items-center justify-between rounded-md border p-3"
                                        >
                                            <div className="space-y-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <Key className="size-4 text-muted-foreground shrink-0" />
                                                    <span className="text-sm font-medium truncate">
                                                        {key.name ||
                                                            "Untitled"}
                                                    </span>
                                                    <Badge
                                                        variant="secondary"
                                                        className="font-mono text-xs shrink-0"
                                                    >
                                                        {key.prefix}
                                                    </Badge>
                                                </div>
                                                <div className="text-xs text-muted-foreground flex gap-3">
                                                    <span>
                                                        Created{" "}
                                                        {formatDate(
                                                            key.created_at,
                                                        )}
                                                    </span>
                                                    <span>
                                                        Last used{" "}
                                                        {formatDate(
                                                            key.last_used_at,
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive shrink-0"
                                                onClick={() => {
                                                    if (
                                                        confirm(
                                                            "Revoke this API key? Any services using it will stop working.",
                                                        )
                                                    ) {
                                                        handleRevokeKey(
                                                            key.id,
                                                        );
                                                    }
                                                }}
                                                title="Revoke key"
                                            >
                                                <Trash2 className="size-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Two-Factor Authentication */}
                <Card>
                    <CardHeader>
                        <CardTitle>Two-Factor Authentication</CardTitle>
                        <CardDescription>
                            Add an extra layer of security with an authenticator
                            app.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {mfaFactors.length > 0 && !enrolling
                            ? (
                                <div className="space-y-3">
                                    <p className="text-sm text-green-600 font-medium">
                                        2FA is enabled
                                    </p>
                                    {mfaFactors.map((f) => (
                                        <div
                                            key={f.id}
                                            className="flex items-center justify-between"
                                        >
                                            <span className="text-sm">
                                                {f.friendlyName ||
                                                    "Authenticator"}
                                            </span>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() =>
                                                    handleUnenroll(f.id)}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )
                            : enrollData
                            ? (
                                <FieldGroup>
                                    <Field>
                                        <FieldLabel>
                                            Scan this QR code with your
                                            authenticator app
                                        </FieldLabel>
                                        <img
                                            src={enrollData.qr}
                                            alt="TOTP QR Code"
                                            className="w-48 min-w-48 h-48 min-h-48 aspect-square object-contain"
                                        />
                                    </Field>
                                    <Field>
                                        <FieldLabel>
                                            Or enter this secret manually
                                        </FieldLabel>
                                        <code className="text-xs bg-muted p-2 rounded block break-all select-all">
                                            {enrollData.secret}
                                        </code>
                                    </Field>
                                    <Field>
                                        <FieldLabel>
                                            Enter the 6-digit code from your app
                                        </FieldLabel>
                                        <Input
                                            value={verifyCode}
                                            onChange={(e) =>
                                                setVerifyCode(e.target.value)}
                                            placeholder="000000"
                                            maxLength={6}
                                        />
                                    </Field>
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            onClick={handleVerifyEnrollment}
                                        >
                                            Verify & Enable
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                setEnrolling(false);
                                                setEnrollData(null);
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </FieldGroup>
                            )
                            : (
                                <Button size="sm" onClick={handleEnroll2FA}>
                                    Enable 2FA
                                </Button>
                            )}
                    </CardContent>
                </Card>

                {/* Danger Zone */}
                <Card className="border-destructive/50">
                    <CardHeader>
                        <CardTitle className="text-destructive">
                            Danger Zone
                        </CardTitle>
                        <CardDescription>
                            Irreversible actions on your account.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Separator />
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium">
                                    Sign out everywhere
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Invalidates all active sessions.
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={logout}
                            >
                                Sign out
                            </Button>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-sm font-medium">
                                    Reset account data
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Delete your papers, progress, stars,
                                    friends, reports, and presence while
                                    keeping your login.
                                </p>
                            </div>
                            <Dialog
                                open={resetDataOpen}
                                onOpenChange={setResetDataOpen}
                            >
                                <DialogTrigger asChild>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        disabled={resettingData}
                                    >
                                        Reset
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>
                                            Reset account data?
                                        </DialogTitle>
                                        <DialogDescription>
                                            This deletes your app data but keeps
                                            your account, email, username,
                                            password, 2FA, and avatar.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button
                                                variant="outline"
                                                disabled={resettingData}
                                            >
                                                Cancel
                                            </Button>
                                        </DialogClose>
                                        <Button
                                            variant="destructive"
                                            disabled={resettingData}
                                            onClick={handleResetData}
                                        >
                                            Reset data
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium">
                                    Delete account
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Permanently delete your account and all
                                    data.
                                </p>
                            </div>
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="destructive" size="sm">
                                        Delete
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Are you sure?</DialogTitle>
                                        <DialogDescription>
                                            This action cannot be undone, and we
                                            would hate to see you go.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button variant="outline">
                                                Cancel
                                            </Button>
                                        </DialogClose>
                                        <Button
                                            variant="destructive"
                                            onClick={handleDeleteAccount}
                                        >
                                            Delete my account
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </CardContent>
                </Card>
            </main>
        </>
    );
}
