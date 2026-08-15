import { useEffect, useState, type RefObject } from 'react';

/**
 * How far `ref`'s box has passed an anchor line set at 55% of the viewport,
 * clamped to 0..1. Drives the timeline's connector fill.
 *
 * Reads are rAF-throttled and the listener is passive, so scrolling stays on
 * the compositor. Returns 1 immediately when the reader has asked for reduced
 * motion — the connector is simply drawn complete rather than animating.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1);
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;

      const travelled = window.innerHeight * 0.55 - rect.top;
      if (travelled <= 0) {
        setProgress(0);
        return;
      }

      // The anchor can only advance as far as the page still has room to
      // scroll. Measuring against the raw element height would strand the fill
      // part-way whenever the element's tail sits below the anchor at the
      // bottom of the page — which is every chain short enough to fit on one
      // screen. Shrinking the denominator by what's actually reachable makes
      // the line complete exactly as scrolling runs out, with no jump.
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const remaining = Math.max(0, maxScroll - window.scrollY);
      const reachable = Math.min(rect.height, travelled + remaining);

      setProgress(reachable > 0 ? Math.min(1, travelled / reachable) : 1);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref]);

  return progress;
}
