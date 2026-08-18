import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type MediaScope = 'all' | 'movie' | 'tv';

/**
 * Movies-vs-Shows lives in the URL (`?type=`) rather than in React state, which
 * is what lets one control in the topbar drive whichever page is mounted, keeps
 * the choice in the back button, and makes a filtered view shareable.
 *
 * `?type` was already Home's own filter param, so this widens the existing
 * contract instead of inventing a second one.
 */
export function useMediaScope(): [MediaScope, (scope: MediaScope) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('type');
  const scope: MediaScope = raw === 'movie' || raw === 'tv' ? raw : 'all';

  const setScope = useCallback(
    (next: MediaScope) => {
      const updated = new URLSearchParams(params);
      if (next === 'all') updated.delete('type');
      else updated.set('type', next);
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  return [scope, setScope];
}
