import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSeasons } from './useSeasons';

vi.mock('@/lib/seasons', () => ({
  fetchSeasonsBatch: vi.fn(),
  seasonsKey: (tmdbId: number) => `tv:${tmdbId}`,
}));
import { fetchSeasonsBatch } from '@/lib/seasons';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(fetchSeasonsBatch).mockReset();
});

describe('useSeasons', () => {
  it('never fetches, and returns null, for a list of only movies', () => {
    const { result } = renderHook(() => useSeasons([{ id: 1, mediaType: 'movie' }]), { wrapper });

    expect(fetchSeasonsBatch).not.toHaveBeenCalled();
    expect(result.current('movie', 1)).toBeNull();
  });

  it('batches every TV id in one call and resolves each lookup to its season count', async () => {
    vi.mocked(fetchSeasonsBatch).mockResolvedValue({
      'tv:1668': { tmdbId: 1668, mediaType: 'tv', numberOfSeasons: 10, fetchedAt: '2026-01-01', stale: false },
      'tv:76331': { tmdbId: 76331, mediaType: 'tv', numberOfSeasons: 8, fetchedAt: '2026-01-01', stale: false },
    });

    const { result } = renderHook(
      () =>
        useSeasons([
          { id: 1668, mediaType: 'tv' }, // Friends
          { id: 76331, mediaType: 'tv' }, // Game of Thrones
          { id: 550, mediaType: 'movie' }, // never asked about
        ]),
      { wrapper },
    );

    await waitFor(() => expect(fetchSeasonsBatch).toHaveBeenCalledWith([1668, 76331]));
    await waitFor(() => expect(result.current('tv', 1668)).toBe(10));
    expect(result.current('tv', 76331)).toBe(8);
    // A movie id is never looked up even if it happens to collide with a TV id.
    expect(result.current('movie', 1668)).toBeNull();
  });

  it('a TV id absent from the response resolves to null rather than throwing', async () => {
    vi.mocked(fetchSeasonsBatch).mockResolvedValue({});
    const { result } = renderHook(() => useSeasons([{ id: 999, mediaType: 'tv' }]), { wrapper });

    await waitFor(() => expect(fetchSeasonsBatch).toHaveBeenCalled());
    expect(result.current('tv', 999)).toBeNull();
  });

  it('deduplicates repeated ids into a single batch request', async () => {
    vi.mocked(fetchSeasonsBatch).mockResolvedValue({});
    renderHook(() => useSeasons([{ id: 1668, mediaType: 'tv' }, { id: 1668, mediaType: 'tv' }]), { wrapper });

    await waitFor(() => expect(fetchSeasonsBatch).toHaveBeenCalledWith([1668]));
  });
});
