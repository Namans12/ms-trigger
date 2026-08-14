import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Lock, Loader2 } from 'lucide-react';

interface LocationState {
  from?: { pathname: string };
}

export default function PassphraseGate() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login.mutateAsync(passphrase);
      const from = (location.state as LocationState)?.from?.pathname || '/list';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid passphrase');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-20 max-w-sm mx-auto text-center">
      <Lock size={32} className="mb-3 text-accent opacity-80" />
      <h2 className="font-display text-lg font-bold text-foreground">My List is private</h2>
      <p className="text-xs text-muted-foreground mt-1 mb-6">Enter the passphrase to unlock your watchlist.</p>

      <form onSubmit={handleSubmit} className="w-full space-y-3">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoFocus
          className="w-full px-3.5 py-2.5 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 text-sm text-center"
        />
        {error && <p className="text-xs text-danger font-medium">{error}</p>}
        <button
          type="submit"
          disabled={login.isPending || !passphrase}
          className="inline-flex items-center justify-center w-full py-2.5 rounded-xl font-semibold text-sm leading-none bg-accent text-accent-foreground hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all"
        >
          {login.isPending ? <Loader2 size={16} className="animate-spin" /> : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
