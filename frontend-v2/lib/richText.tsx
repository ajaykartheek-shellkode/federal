// Agent messages may contain a tiny allow-list of formatting tags (<strong>, <b>, <em>, <i>, <br>).
// They are rendered as React elements — never as raw HTML — so:
//   * anything else (e.g. "<script>") is shown as plain text by React, never executed, and
//   * re-renders keep the existing DOM nodes, so the word-by-word entrance animation of older
//     messages never replays (no flicker when new messages arrive).

import { Fragment, type ReactNode } from "react";

const TAG = /(<\/?(?:strong|b|em|i)\s*>|<br\s*\/?>)/i;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);

/** Rich message → React nodes. `animate` staggers a fade-in per word (CSS only, runs once on mount). */
export function renderRich(html: string, animate = false, stepMs = 22, maxDelayMs = 1400): ReactNode[] {
  const nodes: ReactNode[] = [];
  let bold = false;
  let italic = false;
  let word = 0;

  (html ?? "").split(TAG).forEach((part, i) => {
    if (!part) return;
    const tag = part.toLowerCase().replace(/\s+/g, "");
    if (tag === "<strong>" || tag === "<b>") bold = true;
    else if (tag === "</strong>" || tag === "</b>") bold = false;
    else if (tag === "<em>" || tag === "<i>") italic = true;
    else if (tag === "</em>" || tag === "</i>") italic = false;
    else if (tag.startsWith("<br")) nodes.push(<br key={`br-${i}`} />);
    else {
      decode(part)
        .split(/(\s+)/)
        .forEach((piece, j) => {
          if (!piece) return;
          if (/^\s+$/.test(piece)) {
            nodes.push(<Fragment key={`s-${i}-${j}`}> </Fragment>);
            return;
          }
          const className = [animate && "stream-word", bold && "font-semibold text-ink", italic && "italic"].filter(Boolean).join(" ");
          nodes.push(
            <span
              key={`w-${i}-${j}`}
              className={className || undefined}
              style={animate ? { animationDelay: `${Math.min(word++ * stepMs, maxDelayMs)}ms` } : undefined}
            >
              {piece}
            </span>
          );
        });
    }
  });
  return nodes;
}

/** Plain text of a rich message (for aria labels, previews). */
export function richToPlain(html: string): string {
  return decode((html ?? "").split(TAG).filter((p) => !TAG.test(p)).join(" ")).replace(/\s+/g, " ").trim();
}
