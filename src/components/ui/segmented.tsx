import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  'aria-label'?: string;
  /** Stretch the track to fill its container (for full-width tab rows). */
  fill?: boolean;
  className?: string;
}

/**
 * Segmented control: one track, and a single indicator that slides between
 * segments rather than each segment fading its own background.
 *
 * The indicator is positioned from the active segment's *measured* box, not from
 * a 1/n fraction of the track. Segments size to their labels ("All" is narrower
 * than "Movies"), so a fractional indicator drifts out of alignment — by ~15px
 * on the media-type control. Measuring also survives font swap-in and resize.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );

  const measure = useCallback(() => {
    const seg = segmentRefs.current[activeIndex];
    if (!seg) return;
    setIndicator({ left: seg.offsetLeft, width: seg.offsetWidth });
  }, [activeIndex]);

  useLayoutEffect(measure, [measure, options.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    segmentRefs.current.forEach((s) => s && ro.observe(s));
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative isolate flex h-control shrink-0 items-center rounded-lg bg-secondary p-0.5',
        fill && 'w-full',
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0 -z-10 rounded-[calc(var(--radius)-6px)] bg-accent shadow-sm"
        style={{
          width: indicator.width,
          transform: `translateX(${indicator.left}px)`,
          // Nothing to slide from on the first paint, so don't animate into place.
          transition: indicator.width
            ? `transform var(--dur-enter) var(--ease-emphasized), width var(--dur-enter) var(--ease-emphasized)`
            : 'none',
        }}
      />
      {options.map((opt, i) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            ref={(el) => {
              segmentRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'relative z-10 inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--radius)-6px)] px-3 text-xs font-semibold leading-none transition-colors duration-200',
              // The indicator already animates the movement; squashing the label
              // on press would fight it, so opt out of the global button scale.
              'active:!scale-100',
              active ? 'text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
