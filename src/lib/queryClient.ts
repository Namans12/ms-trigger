import { QueryClient } from "@tanstack/react-query";
import { shouldRetry } from "./http";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      // Default was 3 retries at 1s/2s/4s — on a request that takes the full
      // 16s timeout that is over a minute of spinner before the user is told
      // anything. Two attempts, and none at all for a 4xx. See lib/http.ts.
      retry: shouldRetry,
    },
  },
});
