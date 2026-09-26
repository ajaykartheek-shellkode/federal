import { Suspense } from "react";
import SignInForm from "@/components/auth/SignInForm";

export const metadata = { title: "Sign in · GL Portal" };

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <SignInForm />
    </Suspense>
  );
}
