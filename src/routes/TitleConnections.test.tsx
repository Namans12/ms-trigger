import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TitleConnections from './TitleConnections';

vi.mock('@/lib/tmdbDetail', () => ({ fetchTitleDetail: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/relations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/relations')>('@/lib/relations');
  return {
    ...actual,
    fetchRelations: vi.fn().mockResolvedValue({
      origin: null,
      mustWatch: { before: [], after: [] },
      canWatch: [],
    }),
    suppressRelation: vi.fn(),
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));

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
