import { useState, useCallback } from 'react';
import { Check } from 'lucide-react';

interface ActionButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className: string;
  successClassName?: string;
}

export function ActionButton({ onClick, icon, label, className, successClassName }: ActionButtonProps) {
  const [added, setAdded] = useState(false);

  const handleClick = useCallback(() => {
    onClick();
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }, [onClick]);

  return (
    <button
      onClick={handleClick}
      className={`${added ? (successClassName || 'bg-watched/20 text-watched') : className} transition-all duration-200`}
      disabled={added}
    >
      {added ? (
        <>
          <Check size={11} strokeWidth={3} className="shrink-0 animate-scale-in" /> Added!
        </>
      ) : (
        <>
          {icon} {label}
        </>
      )}
    </button>
  );
}
