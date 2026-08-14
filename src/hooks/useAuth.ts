import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface SessionResponse {
  authenticated: boolean;
}

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch('/api/auth');
  if (!res.ok) return { authenticated: false };
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

  const login = useMutation({
    mutationFn: async (passphrase: string) => {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Invalid passphrase');
      }
      return res.json();
    },
    onSuccess: () => {
      // Set directly rather than invalidate+refetch — mutateAsync callers
      // (e.g. the login form's navigate()) must see the new auth state
      // immediately, not after a second network round-trip.
      queryClient.setQueryData(['auth', 'session'], { authenticated: true });
    },
  });

  const logout = useMutation({
    mutationFn: async () => {
      await fetch('/api/auth', { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'session'], { authenticated: false });
    },
  });

  return {
    isAuthenticated: sessionQuery.data?.authenticated ?? false,
    isLoading: sessionQuery.isLoading,
    login,
    logout,
  };
}
