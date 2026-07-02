import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { toast } from "sonner";
import { apiFetch } from "./client";

const PENDING_EMAIL_CONFIRMATION_KEY = "tppr:pending-email-confirmation";
const CACHED_USER_KEY = "tppr:cached-user";
/** How long the cached user is considered fresh, in milliseconds. */
const USER_CACHE_TTL = 5 * 60 * 1000;

interface CachedUser {
  user: User;
  timestamp: number;
}

interface User {
  user_id: string; // Supabase uses UUIDs
  username: string;
  email: string;
  admin?: boolean;
  admin_available?: boolean;
  avatar_url?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (formData: FormData) => Promise<string | null>;
  signup: (formData: FormData) => Promise<string | null>;
  logout: () => void;
  switchToAdminMode: () => Promise<string | null>;
  /** Re-fetch the user's backend profile (e.g. after changing their avatar). */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => null,
  signup: async () => null,
  logout: () => {},
  switchToAdminMode: async () => null,
  refreshUser: async () => {},
});

function mapUser(supabaseUser: SupabaseUser): User {
  return {
    user_id: supabaseUser.id,
    username: supabaseUser.user_metadata?.username ?? supabaseUser.email?.split("@")[0] ?? "",
    email: supabaseUser.email ?? "",
  };
}

function markPendingEmailConfirmation(email: string) {
  localStorage.setItem(PENDING_EMAIL_CONFIRMATION_KEY, email);
}

function consumePendingEmailConfirmation(email: string | undefined) {
  const pendingEmail = localStorage.getItem(PENDING_EMAIL_CONFIRMATION_KEY);
  if (!pendingEmail || pendingEmail !== email) return false;
  localStorage.removeItem(PENDING_EMAIL_CONFIRMATION_KEY);
  return true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const confirmationToastShown = useRef(false);
  const navigate = useNavigate();

  // Pull avatar_url (and any future profile fields) from the backend, since the
  // backend-stored avatar URL is not part of the Supabase user_metadata.
  const refreshUser = useCallback(async () => {
    try {
      const res = await apiFetch("/api/whoami");
      if (!res.ok) return;
      const data = await res.json();
      setUser((prev) => {
        const next = prev
          ? {
              ...prev,
              username: data.username ?? prev.username,
              email: data.email ?? prev.email,
              avatar_url: data.avatar_url,
              admin: Boolean(data.admin),
              admin_available: Boolean(data.admin_available),
            }
          : prev;
        if (next) {
          const cached: CachedUser = {
            user: next,
            timestamp: Date.now(),
          };
          try {
            localStorage.setItem(CACHED_USER_KEY, JSON.stringify(cached));
          } catch {
            // localStorage may be unavailable (private mode, quota, etc.).
          }
        }
        return next;
      });
    } catch {
      // Backend may be temporarily unreachable; leave the cached user as-is.
    }
  }, []);

  // Read the cached user from localStorage so we can render instantly on
  // initial mount. Returns null if the cache is missing or malformed.
  const readCachedUser = useCallback((): CachedUser | null => {
    try {
      const raw = localStorage.getItem(CACHED_USER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedUser;
      if (!parsed?.user || typeof parsed.timestamp !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    // Get initial session — hydrate from cache first, then refresh if stale.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const mapped = mapUser(session.user);
        // Merge cached profile fields (avatar, admin, etc.) with the
        // freshly-mapped Supabase session user.
        const cached = readCachedUser();
        setUser(
          cached && cached.user.user_id === mapped.user_id
            ? { ...mapped, ...cached.user }
            : mapped,
        );
        setLoading(false);

        // Only hit the backend if the cache is stale.
        const cachedTimestamp = cached?.timestamp ?? 0;
        if (
          !cached ||
          cached.user.user_id !== mapped.user_id ||
          Date.now() - cachedTimestamp > USER_CACHE_TTL
        ) {
          refreshUser();
        }
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ? mapUser(session.user) : null);
        // Only refresh from the backend on genuine sign-in / initial session —
        // NOT on TOKEN_REFRESHED, which can fire on window focus and causes
        // unnecessary refetches.
        if (
          session?.user &&
          (event === "SIGNED_IN" || event === "INITIAL_SESSION")
        ) {
          refreshUser();
        }
        if (
          event === "SIGNED_IN" &&
          session?.user &&
          !confirmationToastShown.current &&
          consumePendingEmailConfirmation(session.user.email)
        ) {
          confirmationToastShown.current = true;
          toast.success("Confirmed!");
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [refreshUser, readCachedUser]);

  async function login(formData: FormData): Promise<string | null> {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  async function signup(formData: FormData): Promise<string | null> {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const username = formData.get("username") as string;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (!error) {
      markPendingEmailConfirmation(email);
    }
    return error ? error.message : null;
  }

  function logout() {
    supabase.auth.signOut().then(() => {
      navigate("/login", { replace: true });
    });
  }

  async function switchToAdminMode(): Promise<string | null> {
    const res = await apiFetch("/api/admin/verify", { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return data?.message ?? "Failed to activate admin mode";
    }
    await refreshUser();
    return null;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        logout,
        switchToAdminMode,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
