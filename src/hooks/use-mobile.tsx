import * as React from "react";

/** Matches Tailwind's `md` breakpoint. Expressed in rem, like Tailwind's own
 *  `(width >= 48rem)`, so JS and CSS agree even if the root font size changes. */
const DESKTOP_QUERY = "(min-width: 48rem)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  // Belt and braces: some embedded/headless browsers resize the viewport
  // without dispatching the media-query `change` event, which would otherwise
  // leave the layout stuck on whichever side of the breakpoint it loaded at.
  window.addEventListener("resize", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/**
 * Read through useSyncExternalStore rather than state-plus-effect so the very
 * first render already knows the width. A desktop visitor never gets a frame of
 * mobile layout (and vice versa) before the effect catches up.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => !window.matchMedia(DESKTOP_QUERY).matches,
    () => false, // server/prerender: assume desktop
  );
}
