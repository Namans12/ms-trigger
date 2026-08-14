interface SpotlightLogoProps {
  size?: number;
  className?: string;
}

/** The spotlight-fixture mark — the product photo, cropped square. Used in the topbar. */
export function SpotlightLogo({ size = 28, className = "" }: SpotlightLogoProps) {
  return (
    <img
      src="/spotlight-photo.png"
      alt="Spotlight"
      width={size}
      height={size}
      className={`rounded-md object-cover shrink-0 ${className}`}
      style={{ width: size, height: size, objectPosition: "50% 65%" }}
    />
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
