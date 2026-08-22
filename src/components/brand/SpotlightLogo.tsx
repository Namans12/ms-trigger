interface SpotlightLogoProps {
  size?: number;
  className?: string;
}

/** The spotlight-fixture mark — the product photo, cropped square. Used in the topbar.
 *
 * Served from a 160px WebP, not the 435x488 source PNG: this renders at 26-28px,
 * so the PNG was shipping ~290KB to fill roughly 0.3% of its own pixels, on every
 * page load. Same aspect ratio as the original, so object-cover + objectPosition
 * still frame it identically. */
export function SpotlightLogo({ size = 28, className = "" }: SpotlightLogoProps) {
  return (
    <img
      src="/spotlight-mark.webp"
      alt="Spotlight"
      width={size}
      height={size}
      // Eager: it's in the topbar on every route, so it is always above the
      // fold and never wants deferring. (No fetchPriority — React 18 doesn't
      // map that prop to the DOM attribute, and at 4KB it wouldn't earn one.)
      loading="eager"
      decoding="async"
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
