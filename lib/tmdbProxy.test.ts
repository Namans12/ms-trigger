import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveProviders, tmdbWatchProvidersBatch, providerCacheKey } from './tmdbProxy';

function watchProvidersPayload(region: string, buckets: Record<string, { provider_name: string }[]>) {
  return { 'watch/providers': { results: { [region]: buckets } } };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubEnv('TMDB_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('resolveProviders', () => {
  it('prefers a local subscription over everything else', () => {
    const details = watchProvidersPayload('IN', {
      flatrate: [{ provider_name: 'Netflix' }],
      buy: [{ provider_name: 'Apple TV' }],
    });
    expect(resolveProviders(details, 'IN')).toEqual(['Netflix']);
  });

  it('tags a purchase-only listing so it can never read as a subscription', () => {
    // "Apple TV" normalizes to the canonical "Apple TV+" (shared/platforms.json's
    // alias table) before tagging -- asserting the raw input name back would
    // just be testing a stub, not this function.
    const details = watchProvidersPayload('IN', { rent: [{ provider_name: 'Apple TV' }] });
    expect(resolveProviders(details, 'IN')).toEqual(['Apple TV+ (Buy/Rent)']);
  });

  it('falls back to a generic label when a purchase listing has no usable name', () => {
    const details = watchProvidersPayload('IN', { buy: [{ provider_name: '' }] });
    expect(resolveProviders(details, 'IN')).toEqual(['Buy/Rent']);
  });

  it('returns nothing when no tier has an answer', () => {
    expect(resolveProviders({}, 'IN')).toEqual([]);
  });
});

describe('tmdbWatchProvidersBatch', () => {
  it('resolves every key from a single fetch attempt each, with no retries', async () => {
    // Two keys: one succeeds immediately, one fails immediately. If a failed
    // leg were still going through fetchWithRetry's default 3 attempts, this
    // mock would be called 4 times (1 + 3), not 2 -- that difference is the
    // whole point of the fix (an 8s-timeout leg retried 3x costs ~25s, and
    // Promise.allSettled waits for the slowest leg before returning anything).
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, watchProvidersPayload('IN', { flatrate: [{ provider_name: 'Netflix' }] })))
      .mockResolvedValueOnce(jsonResponse(500, {}));

    const result = await tmdbWatchProvidersBatch(
      [{ mediaType: 'movie', id: 1 }, { mediaType: 'movie', id: 2 }],
      'IN',
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.providers).toEqual({ 'movie:1': ['Netflix'] });
    expect(result.hadFailures).toBe(true);
  });

  it('omits a failed key rather than reporting it as confirmed-empty', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, {}));

    const result = await tmdbWatchProvidersBatch([{ mediaType: 'movie', id: 1 }], 'IN');

    // The distinction under test: a real "checked, nothing to watch it on"
    // answer is `[]`; a failed check must not look like that, or a transient
    // TMDB error reads as a permanent fact about the title.
    expect(result.providers).toEqual({});
    expect(Object.keys(result.providers)).not.toContain(providerCacheKey({ mediaType: 'movie', id: 1 }));
    expect(result.hadFailures).toBe(true);
  });

  it('reports no failures when every key genuinely has no providers', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, watchProvidersPayload('IN', {})));

    const result = await tmdbWatchProvidersBatch([{ mediaType: 'movie', id: 1 }], 'IN');

    // A real empty answer IS cacheable at the long TTL -- only a failure isn't.
    expect(result.providers).toEqual({ 'movie:1': [] });
    expect(result.hadFailures).toBe(false);
  });

  it('never fires more requests than keys passed in, one per key', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, watchProvidersPayload('IN', {})));

    await tmdbWatchProvidersBatch(
      [{ mediaType: 'movie', id: 1 }, { mediaType: 'tv', id: 2 }, { mediaType: 'movie', id: 3 }],
      'IN',
    );

    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
