import { Loader2 } from 'lucide-react';

/**
 * Shown while a lazy route chunk is in flight.
 *
 * The previous fallback was a bare `min-h-screen bg-background` div, which made
 * a slow chunk look exactly like a crashed one — the same empty screen the
 * stale-chunk bug produced. A visible spinner distinguishes "working on it"
 * from "broken".
 *
 * The 250ms animation delay keeps it honest in the common case: a warm chunk
 * resolves in well under that, so a fast navigation still shows nothing at all
 * rather than a spinner flash.
 */
export function RouteFallback() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <Loader2
        size={22}
        className="animate-spin text-muted-foreground"
        style={{ animation: 'spin 1s linear infinite, fade-in 200ms ease-out 250ms both' }}
      />
    </div>
  );
}
