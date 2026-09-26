"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";

/** Webcam capture (branch counters use an external webcam) with preview + retake. */
export default function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"starting" | "live" | "error">("starting");
  const [error, setError] = useState("");
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        // Browsers only expose the camera on a secure origin (HTTPS, or localhost in development),
        // so on a plain-HTTP deployment the API is simply absent — say that, don't blame the browser.
        setError(
          window.isSecureContext
            ? "This browser doesn't support camera capture. Use Browse instead."
            : "Camera capture needs a secure (HTTPS) connection — this site is served over plain HTTP. " +
              "Photograph with the phone or webcam app and use Browse, or ask IT to put the portal behind HTTPS."
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus("live");
      } catch (e) {
        setStatus("error");
        setError(
          (e as DOMException)?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in the browser, or use Browse."
            : "No camera was found. Connect a webcam, or use Browse."
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  useEffect(() => {
    // Capture phase so the parent dialog's Escape/Tab handling doesn't also react.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") e.stopImmediatePropagation();
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && setShot({ url: URL.createObjectURL(blob), blob }), "image/jpeg", 0.92);
  };

  const accept = () => {
    if (!shot) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    onCapture(new File([shot.blob], `capture-${stamp}.jpg`, { type: "image/jpeg" }));
  };

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-brand-950/80 p-6 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture"
    >
      <motion.div initial={{ scale: 0.97, y: 10 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-3xl overflow-hidden rounded-2xl bg-brand-950 shadow-lift">
        <div className="relative aspect-video bg-black">
          <video ref={videoRef} playsInline muted className={shot ? "hidden" : "h-full w-full object-contain"} />
          {shot && <img src={shot.url} alt="Captured" className="h-full w-full object-contain" />}
          {status === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
              <Spinner size={18} /> Starting camera…
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-10 text-center text-sm text-white/90">
              <Icon name="camera" size={28} className="text-gold-400" />
              {error}
            </div>
          )}
          {status === "live" && !shot && (
            <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-dashed border-white/35">
              <span className="absolute left-3 top-3 rounded-md bg-black/45 px-2 py-1 text-2xs text-white/90">
                Place all ornaments on a plain surface, fully inside the frame
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <Button variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={onClose}>
            Cancel
          </Button>
          {shot ? (
            <div className="flex gap-2">
              <Button variant="secondary" icon="refresh" onClick={() => setShot(null)}>
                Retake
              </Button>
              <Button variant="gold" icon="check" onClick={accept}>
                Use photo
              </Button>
            </div>
          ) : (
            <Button variant="gold" icon="camera" disabled={status !== "live"} onClick={capture}>
              Capture
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
