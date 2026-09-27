"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/format";
import { ease } from "@/lib/motion";
import { useIsDesktop } from "@/lib/useMediaQuery";
import Icon, { type IconName } from "./Icon";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = "md",
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissable?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // A centred modal is wrong on a phone: below the desktop breakpoint every dialog becomes a
  // bottom sheet that rises from the thumb, with its footer pinned above the home indicator.
  const desktop = useIsDesktop();

  // Escape to close, focus trap, restore focus on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // On a phone, autofocusing a field throws up the keyboard before the sheet has settled and
    // hides half the dialog; let the assessor tap the field they want.
    const first = desktop
      ? panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
      : panel?.querySelector<HTMLElement>(FOCUSABLE);
    const focusTimer = window.setTimeout(() => first?.focus(), 60);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && panel) {
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!nodes.length) return;
        const [head, tail] = [nodes[0], nodes[nodes.length - 1]];
        if (e.shiftKey && document.activeElement === head) {
          e.preventDefault();
          tail.focus();
        } else if (!e.shiftKey && document.activeElement === tail) {
          e.preventDefault();
          head.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, dismissable, onClose, desktop]);

  if (!mounted) return null;

  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];

  // While closing, the exiting overlay must never swallow clicks meant for the page.
  return createPortal(
    <div className={open ? undefined : "pointer-events-none"}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[200] flex items-end justify-center desk:items-center desk:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="absolute inset-0 bg-brand-950/45 backdrop-blur-[3px]" onClick={dismissable ? onClose : undefined} />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              initial={desktop ? { opacity: 0, y: 14, scale: 0.98 } : { y: "100%" }}
              animate={
                desktop
                  ? { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease } }
                  : { y: 0, transition: { duration: 0.3, ease } }
              }
              exit={desktop ? { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16 } } : { y: "100%", transition: { duration: 0.2, ease } }}
              className={cn(
                "relative flex w-full flex-col overflow-hidden bg-surface shadow-lift",
                "max-h-[92dvh] rounded-t-3xl",
                "desk:max-h-[min(88vh,860px)] desk:rounded-2xl",
                width
              )}
            >
              {/* Grab handle — the affordance that says "this sheet came from the bottom". */}
              <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong desk:hidden" aria-hidden />
              <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3.5 desk:px-6 desk:py-4">
                <div className="flex items-start gap-3">
                  {icon && (
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                      <Icon name={icon} size={18} />
                    </span>
                  )}
                  <div>
                    <h2 className="text-base font-semibold leading-tight text-ink desk:text-lg">{title}</h2>
                    {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
                  </div>
                </div>
                {dismissable && (
                  <button
                    onClick={onClose}
                    className="-mr-2 flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
                    aria-label="Close"
                  >
                    <Icon name="x" size={17} />
                  </button>
                )}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-none-y px-4 py-4 desk:px-6 desk:py-5">{children}</div>
              {footer && (
                <footer className="flex items-center justify-end gap-2 border-t border-line bg-subtle px-4 py-3 pb-safe desk:px-6 desk:py-3.5 [&>button]:min-h-11 desk:[&>button]:min-h-0">
                  {footer}
                </footer>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  );
}
