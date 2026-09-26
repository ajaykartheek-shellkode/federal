"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, signIn as apiSignIn, signOut as apiSignOut } from "@/lib/api";
import type { StaffUser } from "@/lib/types";

interface AuthValue {
  user: StaffUser | null;
  /** True until the cookie has been checked once — the shell waits rather than flashing. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<StaffUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void fetchCurrentUser().then((u) => {
      if (!live) return;
      setUser(u);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const signedIn = await apiSignIn(email, password);
    setUser(signedIn);
    return signedIn;
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut().catch(() => undefined);
    setUser(null);
    // The verification session id is per-assessor; the next person starts clean.
    try {
      window.localStorage.removeItem("glportal.session");
    } catch {
      /* private window — nothing to clear */
    }
    router.replace("/login");
  }, [router]);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
