import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RouteErrorBoundary } from './RouteErrorBoundary';

// Keep the real isChunkLoadError — the classification is the interesting half —
// but take control of the reload so the test can drive both branches.
vi.mock('@/lib/chunkError', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chunkError')>();
  return { ...actual, reloadForStaleChunk: vi.fn() };
});
import { reloadForStaleChunk } from '@/lib/chunkError';

const STALE_CHUNK = new Error(
  'Failed to fetch dynamically imported module: /assets/TitleDetail-abc123.js',
);

function Boom({ error }: { error: Error }): never {
  throw error;
}

function renderBoundary(children: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/title/movie/109414']}>
      <RouteErrorBoundary>{children}</RouteErrorBoundary>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(reloadForStaleChunk).mockReset();
  // React logs every boundary-caught error; that noise isn't the test's problem.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RouteErrorBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    renderBoundary(<p>The timeline</p>);

    expect(screen.getByText('The timeline')).toBeInTheDocument();
    expect(reloadForStaleChunk).not.toHaveBeenCalled();
  });

  it('recovers a stale chunk by reloading instead of showing an error', () => {
    vi.mocked(reloadForStaleChunk).mockReturnValue(true);

    renderBoundary(<Boom error={STALE_CHUNK} />);

    expect(reloadForStaleChunk).toHaveBeenCalledTimes(1);
    // A reload is in flight, so the user sees the ordinary loading state rather
    // than a failure message they can't act on and that's about to disappear.
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText(/out of date/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Something broke/i)).not.toBeInTheDocument();
  });

  it('explains a stale chunk once reloading has already been tried', () => {
    // Cooldown active: reloading just failed to fix it, so say so.
    vi.mocked(reloadForStaleChunk).mockReturnValue(false);

    renderBoundary(<Boom error={STALE_CHUNK} />);

    expect(screen.getByText(/This page is out of date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('shows a generic message for a real render bug, and never reloads for one', () => {
    renderBoundary(<Boom error={new TypeError("Cannot read properties of undefined (reading 'map')")} />);

    expect(screen.getByText(/Something broke on this page/i)).toBeInTheDocument();
    // Reloading a genuine bug just reproduces it.
    expect(reloadForStaleChunk).not.toHaveBeenCalled();
  });

  it('never leaves the user with an empty screen, whatever the failure', () => {
    const { container } = renderBoundary(<Boom error={new Error('kaboom')} />);

    // This is the actual regression under guard: pre-fix, an uncaught throw
    // unmounted the whole root and left #root empty.
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });
});
