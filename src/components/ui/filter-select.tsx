import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface FilterSelectBaseProps {
  /** Shown on the trigger when nothing is selected, and above the option list. */
  label: string;
  /** Wording for the reset row. Spelled out rather than derived from `label`,
   *  because "All " + label mispluralises ("All platform"). */
  allLabel: string;
  options: string[];
  icon?: React.ReactNode;
  /** Reveal a filter box once the list is long enough to need one. */
  searchThreshold?: number;
  className?: string;
  /** Maps an option's stored value to what's shown for it (trigger text,
   * option row, and search matching) — e.g. an ISO language code to its full
   * name. `value` and `onChange` still deal in the raw options, so the
   * underlying filter stays on the normalized value; only the label changes.
   * Defaults to showing the value as-is. */
  getLabel?: (value: string) => string;
}

interface SingleFilterSelectProps extends FilterSelectBaseProps {
  multiple?: false;
  /** `null` means "no filter"; the trigger then shows `label` in a resting state. */
  value: string | null;
  onChange: (value: string | null) => void;
}

interface MultiFilterSelectProps extends FilterSelectBaseProps {
  multiple: true;
  /** Empty means "no filter"; the trigger then shows `label` in a resting state. */
  value: string[];
  onChange: (value: string[]) => void;
}

type FilterSelectProps = SingleFilterSelectProps | MultiFilterSelectProps;

// A plain `if (props.multiple)` doesn't narrow `props.value`/`props.onChange`
// here — this project builds with `strict: false` (tsconfig.app.json), and
// without strictNullChecks TS's discriminated-union narrowing doesn't hold up
// across the optional `multiple?: false` discriminant. A type-predicate
// function narrows correctly regardless, so route every branch through this.
function isMultiple(props: FilterSelectProps): props is MultiFilterSelectProps {
  return props.multiple === true;
}

/**
 * A filter entry point sized to the same 36px control height as every other
 * bar control. Selecting a value turns the trigger into an accent-tinted chip
 * carrying its own clear button — the reui Filters pattern, where the active
 * filter is legible without opening the menu.
 *
 * `multiple` switches `value`/`onChange` from a single option to an array:
 * picking an option toggles it in place rather than closing the menu, so
 * several can be picked in one visit.
 */
export function FilterSelect(props: FilterSelectProps) {
  const { label, allLabel, options, icon, searchThreshold = 8, className, getLabel = (v) => v } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = isMultiple(props) ? props.value : props.value != null ? [props.value] : [];
  const active = selected.length > 0;

  function toggle(opt: string) {
    if (isMultiple(props)) {
      const next = props.value.includes(opt) ? props.value.filter((v) => v !== opt) : [...props.value, opt];
      props.onChange(next);
    } else {
      props.onChange(opt === props.value ? null : opt);
      setOpen(false);
    }
  }

  function clear() {
    if (isMultiple(props)) props.onChange([]);
    else props.onChange(null);
  }

  const triggerLabel =
    selected.length === 0
      ? label
      : selected.length === 1
        ? getLabel(selected[0])
        : `${getLabel(selected[0])} +${selected.length - 1}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Matches on either the raw value or its label, so searching "hi" and
    // searching "Hindi" both find the same option.
    return q
      ? options.filter((o) => o.toLowerCase().includes(q) || getLabel(o).toLowerCase().includes(q))
      : options;
  }, [options, query, getLabel]);

  const showSearch = options.length >= searchThreshold;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <div
        className={cn(
          'inline-flex h-control shrink-0 items-center rounded-lg border transition-colors duration-200',
          active
            ? 'border-accent/40 bg-accent/12 text-accent'
            : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
          className,
        )}
      >
        <PopoverTrigger
          className={cn(
            // leading-tight (not leading-none): Synonym's glyph box is taller
            // than its font-size at line-height 1, so the trigger label below
            // — which truncates, i.e. clips its own overflow — sliced off
            // descenders ("Language"'s g) at leading-none. leading-tight gives
            // just enough line box to hold the full glyph.
            'inline-flex h-full items-center gap-1.5 rounded-lg px-3 text-xs font-semibold leading-tight active:!scale-100',
            active && 'rounded-r-none pr-2',
          )}
        >
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="max-w-[10rem] truncate">{triggerLabel}</span>
          <ChevronDown
            size={13}
            className={cn('shrink-0 opacity-60 transition-transform duration-200', open && 'rotate-180')}
          />
        </PopoverTrigger>

        {active && (
          <button
            type="button"
            onClick={clear}
            aria-label={`Clear ${label.toLowerCase()} filter`}
            className="grid h-full w-7 place-items-center rounded-r-lg border-l border-accent/25 text-accent/70 hover:text-accent active:!scale-100"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <PopoverContent className="w-64 p-0">
        {showSearch && (
          <div className="relative border-b border-border">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${label.toLowerCase()}…`}
              aria-label={`Filter ${label.toLowerCase()}`}
              className="h-control w-full bg-transparent pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        )}

        <div className="max-h-64 overflow-y-auto p-1.5">
          <OptionRow
            label={allLabel}
            selected={!active}
            onSelect={() => {
              clear();
              setOpen(false);
            }}
          />
          {filtered.map((opt) => (
            <OptionRow key={opt} label={getLabel(opt)} selected={selected.includes(opt)} onSelect={() => toggle(opt)} />
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matches.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OptionRow({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        // leading-tight, not leading-none — see the trigger's comment above;
        // the label span here truncates the same way and clipped the same way.
        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium leading-tight transition-colors active:!scale-100',
        selected ? 'bg-accent/12 text-accent' : 'text-secondary-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <Check size={13} className={cn('shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </button>
  );
}
