"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** 210mm at 96dpi — the width ReportDocument is laid out at, and the width the PDF prints at. */
const A4_PX = 794;

/**
 * Fit the A4 report into a narrow screen.
 *
 * The report is a document, not a dashboard: reflowing it would make the screen and the PDF
 * disagree, and the signed page is the thing of record. So on a phone it is scaled down whole —
 * the way a PDF preview behaves — and stays pinch-zoomable, with Download PDF one tap away.
 * At full width (a desktop, or a tablet in landscape) nothing is scaled at all.
 */
export default function ScaledPage({ children }: { children: ReactNode }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const holder = holderRef.current;
    const page = pageRef.current;
    if (!holder || !page) return;

    const measure = () => {
      const available = holder.clientWidth;
      const next = available >= A4_PX ? 1 : available / A4_PX;
      setScale(next);
      setHeight(next === 1 ? null : page.scrollHeight * next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(holder);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={holderRef} className="w-full" style={height ? { height } : undefined}>
      <div
        ref={pageRef}
        // print: the page must go to paper at its true size, never at the screen's scale.
        className="origin-top-left print:!transform-none"
        style={scale === 1 ? undefined : { transform: `scale(${scale})`, width: A4_PX }}
      >
        {children}
      </div>
    </div>
  );
}
