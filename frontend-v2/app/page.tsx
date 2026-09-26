import RequireAuth from "@/components/auth/RequireAuth";
import AppShell from "@/components/shell/AppShell";

export default function Page() {
  return (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  );
}
