interface SpotlightLogoProps {
  size?: number;
  className?: string;
}

/** The spotlight-fixture mark alone — used in the topbar, favicon, and PWA icons. */
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
        <linearGradient id="spotlight-beam" x1="16" y1="6" x2="16" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#d9bd8f" />
          <stop offset="100%" stopColor="#b99079" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="6.2" r="2.4" fill="url(#spotlight-beam)" />
      <path
        d="M11.4 10.2 L20.6 10.2 L25.4 25.6 C25.9 27.2 24.7 28.8 23 28.8 L9 28.8 C7.3 28.8 6.1 27.2 6.6 25.6 Z"
        fill="url(#spotlight-beam)"
        opacity="0.92"
      />
      <ellipse cx="16" cy="24.6" rx="5.6" ry="1.5" fill="#292728" opacity="0.35" />
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
        <span className="font-display text-xl font-semibold tracking-tight leading-none text-foreground">
          Spotlight
        </span>
        {showTagline && (
          <p className="text-[10px] font-medium tracking-[0.14em] uppercase text-muted-foreground mt-0.5">
            Find what&apos;s worth watching
          </p>
        )}
      </div>
    </div>
  );
}
