// Inline stroke icon set (24px grid, currentColor) — no icon-font dependency.

import type { ReactNode } from "react";

const PATHS = {
  shield: <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6L12 3z" />,
  shieldCheck: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6L12 3z" />
      <path d="M8.8 12.2l2.2 2.2 4.3-4.6" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V5M16 20v-8M21 20H3" />,
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3 4v4h4M12 7.5V12l3 2" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5l1.6 4.3 4.4 1.7-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.7L12 3.5z" />
      <path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  idCard: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h3.5M14.5 13.5h3" />
    </>
  ),
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.3 12.3l2.5 2.5 4.9-5.2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  xCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </>
  ),
  pen: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 7.5l2 2" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  send: <path d="M4.5 12L20 4.5l-4 15.5-4.2-6.3L4.5 12zM11.8 13.7L20 4.5" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.7L4 8" />
      <path d="M4 3.5V8h4.5M4 13a8 8 0 0 0 14.3 4.7L20 16" />
      <path d="M20 20.5V16h-4.5" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.3-4.3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 17v1.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V17" />
    </>
  ),
  printer: (
    <>
      <path d="M6.5 9V3.5h11V9" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M6.5 14h11v6.5h-11z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M7 20h10M4.5 8h15" />
      <path d="M4.5 8L2 14a3 3 0 0 0 5 0L4.5 8zM19.5 8L17 14a3 3 0 0 0 5 0l-2.5-6z" />
    </>
  ),
  weighScale: (
    <>
      <path d="M5 7.5h14M12 7.5v3" />
      <rect x="3.5" y="10.5" width="17" height="9.5" rx="2.5" />
      <rect x="8" y="13.2" width="8" height="4" rx="1" />
    </>
  ),
  gem: (
    <>
      <path d="M6 3.5h12l3.5 5.5L12 21 2.5 9 6 3.5z" />
      <path d="M2.5 9h19M9.5 3.5L8 9l4 12 4-12-1.5-5.5" />
    </>
  ),
  ring: (
    <>
      <circle cx="12" cy="14.5" r="6" />
      <path d="M9.5 8.8L8 5.5l4-2 4 2-1.5 3.3" />
    </>
  ),
  rupee: <path d="M7 4.5h10M7 9h10M10 4.5c3.5 0 5 1.8 5 4.5s-1.7 4.5-5 4.5H7l7.5 7" />,
  bank: (
    <>
      <path d="M3 9.5L12 4l9 5.5M4.5 9.5v8M9 9.5v8M15 9.5v8M19.5 9.5v8M3 20.5h18" />
    </>
  ),
  robot: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="3.5" />
      <path d="M12 4.5V8M9.2 13h.01M14.8 13h.01M9.5 16.2h5" />
      <circle cx="12" cy="3.8" r="1" />
    </>
  ),
  cpu: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <path d="M9.5 2.5v4M14.5 2.5v4M9.5 17.5v4M14.5 17.5v4M2.5 9.5h4M2.5 14.5h4M17.5 9.5h4M17.5 14.5h4" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.3-4.3M11 8.5v5M8.5 11h5" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />,
  logout: <path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5M16 16.5l4.5-4.5L16 7.5M20.5 12H9.5" />,
  flag: <path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5l9 4.5-9 4.5L3 8l9-4.5z" />
      <path d="M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.8,
  label,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {PATHS[name]}
    </svg>
  );
}
