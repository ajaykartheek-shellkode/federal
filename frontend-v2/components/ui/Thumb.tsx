"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { assetUrl } from "@/lib/api";
import { cn } from "@/lib/format";
import Icon, { type IconName } from "./Icon";

/** Asset thumbnail with shimmer while loading, fade/scale-in on arrival and an icon fallback. */
export default function Thumb({
  assetId,
  alt,
  size,
  fallback = "gem",
  className,
  rounded = "rounded-lg",
  onClick,
  contentType,
}: {
  assetId: string | null | undefined;
  alt: string;
  /** Fixed square size in px; omit to fill the parent (set width/height via className). */
  size?: number;
  fallback?: IconName;
  className?: string;
  rounded?: string;
  onClick?: () => void;
  contentType?: string;
}) {
  // Track by asset id so a changed image never inherits the previous image's load state.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const loaded = !!assetId && loadedId === assetId;
  const failed = !!assetId && failedId === assetId;
  const isPdf = contentType === "application/pdf";
  const showImage = assetId && !failed && !isPdf;
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={onClick ? `View ${alt}` : undefined}
      className={cn(
        "group relative shrink-0 overflow-hidden border border-line bg-subtle",
        rounded,
        onClick && "cursor-zoom-in transition-shadow hover:shadow-raised focus-visible:shadow-focus",
        className
      )}
      style={size ? { width: size, height: size } : undefined}
    >
      {showImage && !loaded && <div className="skeleton absolute inset-0" />}
      <AnimatePresence mode="wait">
        {showImage ? (
          <motion.img
            key={assetId}
            src={assetUrl(assetId)}
            alt={alt}
            loading="lazy"
            onLoad={() => setLoadedId(assetId)}
            onError={() => setFailedId(assetId)}
            initial={{ opacity: 0, scale: 1.08 }}
            animate={loaded ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.08 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="h-full w-full object-cover"
          />
        ) : (
          <motion.div
            key="fallback"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn("flex h-full w-full items-center justify-center", isPdf ? "bg-bad-soft text-bad" : "text-ink-faint")}
          >
            {isPdf ? <span className="text-[10px] font-bold">PDF</span> : <Icon name={fallback} size={size ? Math.max(14, size * 0.4) : 28} />}
          </motion.div>
        )}
      </AnimatePresence>
      {onClick && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand-950/0 text-white opacity-0 transition-all group-hover:bg-brand-950/30 group-hover:opacity-100">
          <Icon name="zoomIn" size={size ? Math.min(20, size * 0.4) : 22} />
        </span>
      )}
    </Tag>
  );
}
