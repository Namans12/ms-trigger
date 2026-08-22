import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isChunkLoadError, reloadForStaleChunk } from './chunkError';

describe('isChunkLoadError', () => {
  // One string per browser/layer that can produce this failure — the whole
  // point of the matcher is that none of them share a wording.
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/TitleDetail-abc123.js',
    'error loading dynamically imported module',
    'Loading chunk 42 failed',
    'Loading CSS chunk 7 failed',
    'Importing a module script failed.',
  ])('recognises %j', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('recognises an error whose name carries the signal', () => {
    const err = new Error('nope');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('does not mistake an ordinary render bug for a stale build', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(
      false,
    );
    expect(isChunkLoadError(new Error('Request failed: 500'))).toBe(false);
  });

  it('survives non-Error throws', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('reloadForStaleChunk', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reload = vi.fn();
    // jsdom's location.reload is not spy-able in place, so swap the whole object.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reloads on first call and reports that it handled it', () => {
    expect(reloadForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('refuses to reload twice in a row, so a broken deploy cannot loop', () => {
    expect(reloadForStaleChunk()).toBe(true);
    expect(reloadForStaleChunk()).toBe(false);
    expect(reloadForStaleChunk()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows another reload once the cooldown has passed', () => {
    vi.useFakeTimers();
    expect(reloadForStaleChunk()).toBe(true);

    vi.advanceTimersByTime(31_000);

    expect(reloadForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('still reloads when sessionStorage is unavailable (private mode)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied');
    });

    expect(reloadForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
