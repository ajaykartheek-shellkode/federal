"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/format";

type Mode = "draw" | "type";
const INK = "#082461";

/** e-signature block: draw or type, then lock. Prints cleanly. */
export default function SignaturePad({ role, name, detail }: { role: string; name?: string; detail: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [mode, setMode] = useState<Mode>("draw");
  const [hasInk, setHasInk] = useState(false);
  const [typed, setTyped] = useState("");
  const [signed, setSigned] = useState<{ at: string; image?: string; text?: string } | null>(null);

  // Size the canvas backing store to its CSS size × devicePixelRatio for crisp strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "draw" || signed) return;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = INK;
      setHasInk(false);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mode, signed]);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  };
  const onUp = () => {
    drawing.current = false;
  };

  const clear = () => {
    const c = canvasRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const canSign = mode === "draw" ? hasInk : typed.trim().length >= 2;
  const sign = () => {
    const at = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    setSigned(mode === "draw" ? { at, image: canvasRef.current?.toDataURL("image/png") } : { at, text: typed.trim() });
  };

  return (
    <div className="report-avoid-break flex-1 rounded-xl border border-[#E3E8F0] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#58647A]">{role}</span>
        {!signed && (
          <div className="no-print flex gap-1">
            {(["draw", "type"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ring-1",
                  mode === m ? "bg-[#EEF4FB] text-[#004E96] ring-[#B6CFEC]" : "text-[#58647A] ring-[#E3E8F0] hover:text-[#15223A]"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {signed ? (
        <>
          <div className="flex h-14 items-end border-b border-dashed border-[#7C879A] pb-1">
            {signed.image ? (
              <img src={signed.image} alt={`${role} signature`} className="max-h-[52px] max-w-full" />
            ) : (
              <span className="text-2xl italic text-[#082461]" style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive" }}>
                {signed.text}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#35404F]">
            <span>{detail}</span>
            <span>{signed.at}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10.5px] font-semibold text-[#0E9258]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M8.3 12.3l2.5 2.5 4.9-5.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              e-Signed
            </span>
            <button onClick={() => setSigned(null)} className="no-print text-[11px] text-[#58647A] underline-offset-2 hover:underline">
              Re-sign
            </button>
          </div>
        </>
      ) : (
        <>
          {mode === "draw" ? (
            <div className="relative">
              <canvas
                ref={canvasRef}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                className="h-16 w-full cursor-crosshair touch-none rounded-lg border border-[#E3E8F0] bg-[#F7F9FC]"
                aria-label={`${role} signature pad`}
              />
              {!hasInk && <span className="no-print pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#7C879A]">Sign here</span>}
            </div>
          ) : (
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={name ? `Type full name (e.g. ${name})` : "Type full name"}
              className="h-16 w-full rounded-lg border border-[#E3E8F0] bg-[#F7F9FC] px-3 text-xl italic text-[#082461] outline-none focus:border-[#004E96]"
              style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive" }}
            />
          )}
          <div className="no-print mt-2 flex items-center justify-between">
            <span className="text-[11px] text-[#58647A]">{detail}</span>
            <div className="flex items-center gap-2">
              {mode === "draw" && hasInk && (
                <button onClick={clear} className="text-[11px] text-[#58647A] hover:underline">
                  Clear
                </button>
              )}
              <button
                onClick={sign}
                disabled={!canSign}
                className="rounded-full bg-[#004E96] px-4 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#003F7C] disabled:bg-[#CBD5E2]"
              >
                Sign
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
