import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TitleConnections from './TitleConnections';
import type { RelatedTitle, TitleRelations } from '@/lib/relations';

vi.mock('@/lib/tmdbDetail', () => ({ fetchTitleDetail: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/relations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/relations')>('@/lib/relations');
  return {
    ...actual,
    fetchRelations: vi.fn().mockResolvedValue({
      origin: null,
      mustWatch: { before: [], after: [] },
      canWatch: [],
      depth: 1,
      hasMore: false,
    }),
    suppressRelation: vi.fn(),
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));

import { fetchRelations } from '@/lib/relations';

function related(overrides: Partial<RelatedTitle>): RelatedTitle {
  return {
    tmdbId: 1,
    mediaType: 'movie',
    title: 'Some Film',
    posterUrl: null,
    releaseDate: '2020-01-01',
    reason: null,
    source: 'seed',
    hop: 1,
    ...overrides,
  };
}

function titleRelations(overrides: Partial<TitleRelations>): TitleRelations {
  return {
    origin: null,
    mustWatch: { before: [], after: [] },
    canWatch: [],
    depth: 1,
    hasMore: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(fetchRelations).mockReset();
  vi.mocked(fetchRelations).mockResolvedValue(titleRelations({}));
});

/** Stands in for TitleDetail: real enough to prove the bug, without pulling
 * in that whole page's dependency graph. Its back button is the same
 * `navigate(-1)` pattern TitleDetail.tsx actually uses — what matters for
 * this regression is only that it's a genuine history pop, same as here. */
function TitleDetailStub() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <p>Title Detail Stub</p>
      <button onClick={() => (location.key === 'default' ? navigate('/') : navigate(-1))}>
        Stub back
      </button>
    </div>
  );
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/before', '/title/movie/1', '/title/movie/1/connections']} initialIndex={2}>
        <Routes>
          <Route path="/before" element={<p>Before Page</p>} />
          <Route path="/title/:type/:id" element={<TitleDetailStub />} />
          <Route path="/title/:type/:id/connections" element={<TitleConnections />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TitleConnections back navigation', () => {
  it('going back from Connections, then back again, reaches the page before it — not a loop back to Connections', async () => {
    // Reproduces the exact loop reported live: Search -> a title -> its Watch
    // order -> back (lands on the title, as expected) -> back again used to
    // land right back on Watch order instead of continuing further back,
    // because the old back link pushed a new history entry onto the title
    // page rather than popping to the one already there.
    const user = userEvent.setup();
    renderApp();

    // Queried by text and its nearest clickable ancestor, not by role — the
    // whole point of this test is to survive a swap between a <button> and
    // an <a>, since that swap (Link vs a real history pop) is the bug.
    const back = (await screen.findByText('Back')).closest('a, button');
    await user.click(back!);
    expect(await screen.findByText('Title Detail Stub')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /stub back/i }));
    expect(await screen.findByText('Before Page')).toBeInTheDocument();
  });
});

describe('Must Watch and Can Watch merged into one timeline', () => {
  it('slots a can-watch title into the chain by release date, not in a separate section', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({
      origin: { title: 'Endgame-like Film', posterUrl: null, releaseDate: '2019-04-24' },
      mustWatch: {
        before: [related({ tmdbId: 2, title: 'Setup Film', releaseDate: '2018-01-01' })],
        after: [],
      },
      canWatch: [
        related({
          tmdbId: 3,
          mediaType: 'tv',
          title: 'Bridging Show',
          releaseDate: '2021-01-15',
          reason: 'Explains what the survivors do in the gap between these two films.',
        }),
      ],
    }));
    renderApp();

    // Chronological order — the can-watch title (2021) sits AFTER the current
    // title (2019) in one continuous list, not off in its own section.
    const titles = (await screen.findAllByRole('heading', { level: 3 })).map((h) => h.textContent);
    expect(titles).toEqual(['Setup Film', 'Endgame-like Film', 'Bridging Show']);
    expect(screen.getByText(/explains what the survivors do/i)).toBeInTheDocument();
    // No leftover standalone "Can Watch" section heading from the old layout.
    expect(screen.queryByRole('heading', { name: /^can watch$/i })).not.toBeInTheDocument();
  });

  it('marks the can-watch node distinctly (dashed) and leaves must-watch nodes solid', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({
      origin: { title: 'Current Film', posterUrl: null, releaseDate: '2020-06-01' },
      mustWatch: { before: [related({ tmdbId: 2, title: 'Required Prequel', releaseDate: '2019-01-01' })], after: [] },
      canWatch: [related({ tmdbId: 3, title: 'Optional Extra', releaseDate: '2020-01-01', reason: 'A specific callback.' })],
    }));
    const { container } = renderApp();

    await screen.findByText('Optional Extra');
    const nodeCircles = container.querySelectorAll('.rounded-full.border.text-\\[11px\\]');
    const dashedCount = [...nodeCircles].filter((el) => el.className.includes('border-dashed')).length;
    // Exactly the one can-watch node is dashed; the required prequel and the
    // current title's own nodes stay solid.
    expect(dashedCount).toBe(1);
    expect(screen.getByText(/can watch/i)).toBeInTheDocument();
  });

  it('keeps "Part X of Y" counting only the required chain, not can-watch extras', async () => {
    vi.mocked(fetchRelations).mockResolvedValue(titleRelations({
      origin: { title: 'Current Film', posterUrl: null, releaseDate: '2020-06-01' },
      mustWatch: { before: [related({ tmdbId: 2, title: 'Required Prequel', releaseDate: '2019-01-01' })], after: [] },
      canWatch: [
        related({ tmdbId: 3, title: 'Optional A', releaseDate: '2020-01-01', reason: 'x' }),
        related({ tmdbId: 4, title: 'Optional B', releaseDate: '2020-03-01', reason: 'y' }),
      ],
    }));
    renderApp();

    // Two required entries (Required Prequel + Current Film) — the two
    // can-watch extras must not inflate this count to 4.
    expect(await screen.findByText('Part 2 of 2')).toBeInTheDocument();
  });
});
