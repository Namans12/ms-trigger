import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface FilterSelectProps {
  /** Shown on the trigger when nothing is selected, and above the option list. */
  label: string;
  /** Wording for the reset row. Spelled out rather than derived from `label`,
   *  because "All " + label mispluralises ("All platform"). */
  allLabel: string;
  /** `null` means "no filter"; the trigger then shows `label` in a resting state. */
  value: string | null;
  onChange: (value: string | null) => void;
  options: string[];
  icon?: React.ReactNode;
  /** Reveal a filter box once the list is long enough to need one. */
  searchThreshold?: number;
  className?: string;
}

/**
 * A filter entry point sized to the same 36px control height as every other
 * bar control. Selecting a value turns the trigger into an accent-tinted chip
 * carrying its own clear button — the reui Filters pattern, where the active
 * filter is legible without opening the menu.
 */
export function FilterSelect({
  label,
  allLabel,
  value,
  onChange,
  options,
  icon,
  searchThreshold = 8,
  className,
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const active = value != null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

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
            'inline-flex h-full items-center gap-1.5 rounded-lg px-3 text-xs font-semibold leading-none active:!scale-100',
            active && 'rounded-r-none pr-2',
          )}
        >
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="max-w-[10rem] truncate">{value ?? label}</span>
          <ChevronDown
            size={13}
            className={cn('shrink-0 opacity-60 transition-transform duration-200', open && 'rotate-180')}
          />
        </PopoverTrigger>

        {active && (
          <button
            type="button"
            onClick={() => onChange(null)}
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
              onChange(null);
              setOpen(false);
            }}
          />
          {filtered.map((opt) => (
            <OptionRow
              key={opt}
              label={opt}
              selected={opt === value}
              onSelect={() => {
                onChange(opt === value ? null : opt);
                setOpen(false);
              }}
            />
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
        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium leading-none transition-colors active:!scale-100',
        selected ? 'bg-accent/12 text-accent' : 'text-secondary-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <Check size={13} className={cn('shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </button>
  );
}
