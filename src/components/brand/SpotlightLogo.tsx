interface SpotlightLogoProps {
  size?: number;
  className?: string;
}

/** The spotlight-cone mark alone — used in the topbar, favicon, and PWA icons. */
export function SpotlightLogo({ size = 28, className = "" }: SpotlightLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Spotlight"
    >
      <defs>
        <linearGradient id="spotlight-beam" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%" stopColor="#ffd166" />
          <stop offset="100%" stopColor="#ffa11a" />
        </linearGradient>
        <radialGradient id="spotlight-source" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff7e6" />
          <stop offset="100%" stopColor="#ffd166" />
        </radialGradient>
      </defs>
      {/* beam: narrow near the source (top-right), widening toward the bottom-left */}
      <path
        d="M22 3
           C 24.5 3 26 5 25 7.3
           L 12 26.5
           C 10.3 29 6.6 28 6.9 25.1
           L 17.4 6.2
           C 18.1 4.3 19.9 3 22 3 Z"
        fill="url(#spotlight-beam)"
      />
      {/* bright source ellipse at the narrow end */}
      <ellipse cx="21.2" cy="6.4" rx="3.6" ry="2.6" fill="url(#spotlight-source)" transform="rotate(-40 21.2 6.4)" />
    </svg>
  );
}

interface SpotlightWordmarkProps {
  iconSize?: number;
  className?: string;
  showTagline?: boolean;
}

/** Full lockup: icon + "Spotlight" wordmark, optional tagline underneath. */
export function SpotlightWordmark({ iconSize = 30, className = "", showTagline = false }: SpotlightWordmarkProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <SpotlightLogo size={iconSize} />
      <div>
        <span className="font-display text-xl font-extrabold tracking-tight leading-none text-gradient">
          Spotlight
        </span>
        {showTagline && (
          <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-muted-foreground mt-0.5">
            Find what&apos;s worth watching
          </p>
        )}
      </div>
    </div>
  );
}
