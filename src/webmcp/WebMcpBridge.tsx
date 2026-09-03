import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { registerSpotlightTools } from './registerTools';

/** Registers Spotlight's WebMCP tools once, for the lifetime of the app.
 * Renders nothing — this is a side-effect-only bridge between the browser's
 * document.modelContext and the app's existing React Query client, so tool
 * calls invalidate the same caches a click would and the UI updates live. */
export function WebMcpBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const controller = new AbortController();
    registerSpotlightTools(queryClient, controller.signal);
    return () => controller.abort();
    // queryClient is a stable singleton (see lib/queryClient.ts) — this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
