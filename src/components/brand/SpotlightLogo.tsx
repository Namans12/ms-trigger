interface SpotlightLogoProps {
  size?: number;
  className?: string;
  animated?: boolean;
  /** Fill the parent's box via CSS instead of fixed pixel width/height — for responsive hero usage. */
  fluid?: boolean;
}

/**
 * The spotlight-fixture mark alone — a stylized track spotlight (mount,
 * yoke, barrel, barn doors, lit lens, beam), no text. Used in the topbar,
 * favicon, PWA icons, and the intro screen (with `animated` for the
 * flicker-on + beam-grow keyframes).
 */
export function SpotlightLogo({ size = 28, className = "", animated = false, fluid = false }: SpotlightLogoProps) {
  return (
    <svg
      width={fluid ? undefined : size}
      height={fluid ? undefined : size}
      viewBox="0 0 64 64"
      className={`${fluid ? "w-full h-full" : ""} ${animated ? "spotlight-mark-animated" : ""} ${className}`}
      role="img"
      aria-label="Spotlight"
    >
      <defs>
        <linearGradient id="sl-housing" x1="14" y1="13" x2="34" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6b635b" />
          <stop offset="100%" stopColor="#28241f" />
        </linearGradient>
        <linearGradient id="sl-door" x1="32" y1="4" x2="43" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#514a41" />
          <stop offset="100%" stopColor="#1c1a19" />
        </linearGradient>
        <radialGradient id="sl-lens" cx="34" cy="20" r="6.4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff3d6" />
          <stop offset="55%" stopColor="#e9c98e" />
          <stop offset="100%" stopColor="#b99079" />
        </radialGradient>
        <linearGradient id="sl-beam" x1="33.5" y1="21.9" x2="55" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f3dcae" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#b99079" stopOpacity="0" />
        </linearGradient>
      </defs>

      <polygon className="spotlight-mark-beam" points="33.5,21.9 50.3,52.8 59.7,35.2" fill="url(#sl-beam)" />

      <g stroke="#1c1a19" strokeWidth="2.4" strokeLinecap="round" fill="none">
        <line x1="18" y1="2" x2="18" y2="10.5" />
        <path d="M18 10.5 C18 13.5 18.4 15 19.8 16.5" />
      </g>
      <circle cx="18" cy="10.5" r="1.6" fill="#1c1a19" />

      <g transform="rotate(28 30 20)">
        <ellipse cx="14" cy="20" rx="6.2" ry="6.6" fill="url(#sl-housing)" stroke="#8a8078" strokeWidth="0.5" strokeOpacity="0.5" />
        <rect x="14" y="13.6" width="20" height="12.8" rx="6" fill="url(#sl-housing)" stroke="#8a8078" strokeWidth="0.5" strokeOpacity="0.5" />
        <polygon points="32,13 43,4 39.5,15.5" fill="url(#sl-door)" />
        <polygon points="32,27 43,36 39.5,24.5" fill="url(#sl-door)" />
        <circle cx="34" cy="20" r="7.2" fill="#1c1a19" />
        <circle className="spotlight-mark-lens" cx="34" cy="20" r="5.8" fill="url(#sl-lens)" />
      </g>
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
