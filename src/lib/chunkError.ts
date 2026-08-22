/**
 * Stale-build recovery.
 *
 * Every route in App.tsx is a `lazy()` chunk with a content-hashed filename,
 * and the PWA service worker is registered `autoUpdate` (vite.config.ts), which
 * compiles to `skipWaiting` + `clientsClaim` + `cleanupOutdatedCaches`. So when
 * a new build ships, the new worker takes over an *already-open* tab and drops
 * the previous precache — while that tab is still running the old build's JS,
 * holding old chunk hashes. The next navigation to a not-yet-loaded route asks
 * for `assets/TitleDetail-<oldhash>.js`, which is gone from both the cache and
 * the server, so `import()` rejects, `lazy()` rethrows during render, and with
 * no boundary React 18 unmounts the whole root — a blank page that only a
 * manual refresh cures. That is the bug this module exists to close.
 */

const RELOAD_STAMP_KEY = 'spotlight:stale-chunk-reload';

/** Long enough that a genuinely broken deploy can't spin, short enough that the
 *  next real update still self-heals rather than needing a manual refresh. */
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * Chunk failures surface with different wording per browser and per layer
 * (Vite's preload helper, the bare dynamic import, the CSS chunk loader), and
 * none of them carry a machine-readable code — so message matching is the only
 * option available.
 */
export function isChunkLoadError(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|dynamically imported module|ChunkLoadError/i.test(
    text,
  );
}

/**
 * Reload to pick up the new index.html and its fresh asset hashes.
 *
 * Rate-limited via sessionStorage: if the reload doesn't actually fix things
 * (a truly broken deploy, an offline device), we must not trap the user in a
 * refresh loop — better to fall through and let the caller render an error.
 *
 * @returns true if a reload was triggered and the caller should stop.
 */
export function reloadForStaleChunk(): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) ?? 0);
  } catch {
    // Private mode / storage disabled — treat as "never reloaded". A single
    // extra reload is a far better outcome than a permanently blank page.
  }

  if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;

  try {
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
  } catch {
    // Ignore — see above.
  }
  window.location.reload();
  return true;
}

/**
 * Vite fires `vite:preloadError` when its module-preload helper can't fetch a
 * dynamic import. Catching it here recovers the tab *before* React renders the
 * failure, which is the difference between a flicker and a blank screen.
 */
export function installChunkErrorRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    // Suppress Vite's default rethrow; we're handling recovery ourselves.
    event.preventDefault();
    if (!reloadForStaleChunk()) {
      // Cooldown active: let the route error boundary show a real message.
      console.error('[spotlight] chunk preload failed and reload is on cooldown', event);
    }
  });

  // A rejected `import()` that nothing awaited still means the build is stale.
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault();
      reloadForStaleChunk();
    }
  });
}
