"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { FederalMonogram } from "@/components/shell/Brand";
import Spinner from "@/components/ui/Spinner";

/** Renders its children only for a signed-in assessor; anyone else lands on /login. */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || user) return;
    const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}`);
  }, [loading, user, pathname, router]);

  if (user) return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas">
      <FederalMonogram />
      <span className="flex items-center gap-2 text-xs font-medium text-ink-muted">
        <Spinner size={14} /> {loading ? "Checking your session…" : "Taking you to sign in…"}
      </span>
    </div>
  );
}
