import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

interface SessionResponse {
  authenticated: boolean;
  user: SessionUser | null;
}

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch('/api/auth');
  if (!res.ok) return { authenticated: false, user: null };
  return res.json();
}

export function useAuth() {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: fetchSession,
    staleTime: 60_000,
    retry: false,
  });

  /** Takes the ID token Google Identity Services hands back after sign-in —
   * a JWT the backend verifies against Google's public keys, not a password. */
  const login = useMutation({
    mutationFn: async (idToken: string) => {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Sign-in failed');
      }
      return res.json();
    },
    onSuccess: (data: { user: SessionUser }) => {
      // Set directly rather than invalidate+refetch — mutateAsync callers
      // (e.g. the login page's navigate()) must see the new auth state
      // immediately, not after a second network round-trip.
      queryClient.setQueryData(['auth', 'session'], { authenticated: true, user: data.user });
    },
  });

  const logout = useMutation({
    mutationFn: async () => {
      await fetch('/api/auth', { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'session'], { authenticated: false, user: null });
    },
  });

  return {
    isAuthenticated: sessionQuery.data?.authenticated ?? false,
    isLoading: sessionQuery.isLoading,
    user: sessionQuery.data?.user ?? null,
    login,
    logout,
  };
}
