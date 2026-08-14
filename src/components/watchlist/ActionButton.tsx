import { useState, useCallback } from 'react';
import { Check } from 'lucide-react';

interface ActionButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className: string;
  successClassName?: string;
  /** Needed when `label` is empty (icon-only button) so it stays announceable. */
  ariaLabel?: string;
}

export function ActionButton({ onClick, icon, label, className, successClassName, ariaLabel }: ActionButtonProps) {
  const [added, setAdded] = useState(false);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // These buttons render inside the card's <Link>; without this a click
      // would both add the title and navigate away from the grid.
      e.preventDefault();
      e.stopPropagation();
      onClick();
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    },
    [onClick],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel || label || undefined}
      className={`${added ? (successClassName || 'bg-watched/20 text-watched') : className} transition-all duration-200`}
      disabled={added}
    >
      {added ? (
        <>
          <Check size={13} strokeWidth={3} className="shrink-0 animate-scale-in" />
          {label ? ' Added' : ''}
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </button>
  );
}
