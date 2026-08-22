/**
 * The browser-side fetch layer.
 *
 * Server code already guards every outbound call with `AbortSignal.timeout`
 * (lib/tmdbProxy.ts, lib/omdb.ts, lib/tmdbSeasons.ts); the client never got the
 * same treatment, so a request that never settles left a route spinner up
 * forever with no way out but a manual refresh. Everything here exists to make
 * a stuck request *fail* — visibly, and soon enough to be actionable.
 */

/** Vercel caps our functions at 15s (vercel.json `maxDuration`), so a request
 *  still open past that is never coming back — waiting longer only prolongs a
 *  spinner the user is already tired of. */
const DEFAULT_TIMEOUT_MS = 16_000;

/** Carries the HTTP status so retry policy can distinguish "try again" (5xx,
 *  network) from "this will never work" (4xx). */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class TimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${url} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * `fetch` + timeout + non-OK-is-an-error + JSON parse.
 *
 * Throwing (rather than returning undefined) matters for React Query: a query
 * function that resolves `undefined` is treated as a hard failure with a
 * useless "data is undefined" message, and still burns the full retry budget.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError DOMException; remap it so
    // callers get a stable, named error rather than a DOM abort.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new TimeoutError(url, timeoutMs);
    }
    throw err;
  }

  if (!res.ok) {
    throw new HttpError(res.status, `Request to ${url} failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Retry policy shared by every query.
 *
 * A 4xx is a verdict, not a hiccup — retrying a 404 or a 429 three times just
 * triples the wait before the user sees the truth, and in the 429 case actively
 * makes the rate limit worse (lib/rateLimit.ts allows 30 req/min per IP).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}
