import type { ReleaseItem } from "@/types/digest";
import type { RatingLookup } from "@/hooks/useRatings";
import { ReleaseGrid } from "./ReleaseGrid";

interface ProviderGroupProps {
  provider: string;
  items: ReleaseItem[];
  linkBase?: string;
  ratingFor: RatingLookup;
}

export function ProviderGroup({ provider, items, linkBase, ratingFor }: ProviderGroupProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{provider}</p>
      <ReleaseGrid items={items} linkBase={linkBase} ratingFor={ratingFor} />
    </div>
  );
}
