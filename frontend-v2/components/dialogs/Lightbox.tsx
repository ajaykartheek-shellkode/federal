"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";

export default function Lightbox({
  open,
  src,
  title,
  caption,
  contentType,
  onClose,
}: {
  open: boolean;
  src: string;
  title: string;
  caption?: string;
  contentType?: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setLoaded(false), [src]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  const isPdf = contentType === "application/pdf";

  return createPortal(
    <div className={open ? undefined : "pointer-events-none"}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[250] flex flex-col bg-brand-950/90 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={onClose}
          >
            <div className="flex items-center justify-between px-6 py-4 text-white" onClick={(e) => e.stopPropagation()}>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{title}</p>
                {caption && <p className="truncate text-xs text-white/60">{caption}</p>}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={src}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <Icon name="external" size={14} /> Open original
                </a>
                <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white">
                  <Icon name="x" size={18} />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-6">
              {isPdf ? (
                <motion.iframe
                  initial={{ scale: 0.97, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  src={src}
                  title={title}
                  className="h-full w-full max-w-4xl rounded-xl bg-white"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  {!loaded && <Spinner size={28} className="absolute text-white/70" />}
                  <motion.img
                    src={src}
                    alt={title}
                    onLoad={() => setLoaded(true)}
                    onClick={(e) => e.stopPropagation()}
                    initial={{ scale: 0.96, opacity: 0 }}
                    animate={loaded ? { scale: 1, opacity: 1 } : { scale: 0.96, opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="max-h-full max-w-full rounded-xl object-contain shadow-lift"
                  />
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  );
}
