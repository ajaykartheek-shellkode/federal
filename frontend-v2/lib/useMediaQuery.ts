"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query.
 *
 * Server-rendered as `false`; the shell only mounts after the session check has resolved, so by
 * then the real value is known and the layout never flashes the wrong way round.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** True on the three-column desktop shell; false on the single-column phone/tablet layout. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1180px)");
