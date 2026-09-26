"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type DragEvent } from "react";
import Icon from "@/components/ui/Icon";
import { cn } from "@/lib/format";
import CameraCapture from "./CameraCapture";

export const MAX_FILE_MB = 15;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateFile(file: File, allowPdf: boolean): string | null {
  const isImage = IMAGE_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isImage && !(allowPdf && isPdf)) return `${file.name}: use a JPEG, PNG or WebP image${allowPdf ? " or a PDF" : ""}.`;
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `${file.name}: larger than ${MAX_FILE_MB} MB.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  return null;
}

/** Object URL for an image preview, created per effect run so StrictMode can't revoke a live URL. */
export function usePreview(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

/** Drag-and-drop / browse / camera picker. */
export function DropZone({
  onFiles,
  multiple = false,
  allowPdf = false,
  disabled = false,
  compact = false,
  cameraLabel = "Use camera",
  title,
  hint,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  allowPdf?: boolean;
  disabled?: boolean;
  compact?: boolean;
  cameraLabel?: string;
  title: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [camera, setCamera] = useState(false);
  // The camera API only exists on a secure origin; on plain HTTP the button would open a dead dialog.
  const [cameraAvailable, setCameraAvailable] = useState(true);

  useEffect(() => {
    setCameraAvailable(!!navigator.mediaDevices?.getUserMedia);
  }, []);

  const accept = allowPdf ? "image/jpeg,image/png,image/webp,application/pdf" : "image/jpeg,image/png,image/webp";

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "relative flex items-center gap-4 rounded-xl border-2 border-dashed transition-colors",
          compact ? "px-3 py-2.5" : "flex-col justify-center px-6 py-7 text-center",
          over ? "border-brand-500 bg-brand-50" : "border-line-strong bg-subtle",
          disabled && "opacity-50"
        )}
      >
        {!compact && (
          <motion.span
            animate={over ? { y: -3, scale: 1.05 } : { y: 0, scale: 1 }}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-brand-600 shadow-xs ring-1 ring-line"
          >
            <Icon name="upload" size={22} />
          </motion.span>
        )}
        <div className={cn(compact && "min-w-0 flex-1")}>
          <p className={cn("font-semibold text-ink", compact ? "text-xs" : "text-sm")}>{title}</p>
          {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
        </div>
        <div className={cn("flex items-center gap-2", !compact && "mt-1")}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-xs font-semibold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed"
          >
            <Icon name="image" size={14} /> Browse
          </button>
          <button
            type="button"
            disabled={disabled || !cameraAvailable}
            onClick={() => setCamera(true)}
            title={cameraAvailable ? undefined : "Camera capture needs an HTTPS connection — use Browse"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-xs font-semibold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:border-line-strong disabled:hover:bg-surface"
          >
            <Icon name="camera" size={14} /> {cameraLabel}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
      </div>
      <AnimatePresence>
        {camera && (
          <CameraCapture
            onClose={() => setCamera(false)}
            onCapture={(file) => {
              setCamera(false);
              onFiles([file]);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export function FileChip({ file, onRemove }: { file: File; onRemove?: () => void }) {
  const preview = usePreview(file);
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-surface p-1.5 pr-2">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-subtle">
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : file.type === "application/pdf" ? (
          <span className="text-[10px] font-bold text-bad">PDF</span>
        ) : (
          <Icon name="image" size={16} className="text-ink-faint" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-ink">{file.name}</p>
        <p className="text-2xs text-ink-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="rounded-md p-1 text-ink-faint hover:bg-bad-soft hover:text-bad">
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  );
}
