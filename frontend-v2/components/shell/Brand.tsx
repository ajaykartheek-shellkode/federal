import { cn } from "@/lib/format";

/** "Federal Bank" wordmark: bold italic royal blue with the signature amber underline. */
export function FederalWordmark({ className, invert = false, size = 22 }: { className?: string; invert?: boolean; size?: number }) {
  return (
    <span className={cn("relative inline-flex flex-col leading-none", className)} aria-label="Federal Bank">
      <span
        className={cn("font-bold italic tracking-[-0.01em]", invert ? "text-white" : "text-brand-600")}
        style={{ fontSize: size }}
      >
        Federal Bank
      </span>
      <svg viewBox="0 0 120 6" preserveAspectRatio="none" className="mt-[3px] h-[4px] w-full" aria-hidden>
        <path d="M2 4.2 C 30 1.2, 80 1.2, 118 3.4" stroke="#FAA619" strokeWidth="3.2" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  );
}

/** Compact "F" monogram for the navigation rail. */
export function FederalMonogram({ className }: { className?: string }) {
  return (
    <span
      className={cn("relative flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-raised", className)}
      aria-label="Federal Bank"
    >
      <span className="text-[22px] font-bold italic leading-none text-brand-600">F</span>
      <span className="absolute bottom-[7px] left-[11px] h-[3px] w-[18px] rounded-full bg-gold-500" />
    </span>
  );
}
