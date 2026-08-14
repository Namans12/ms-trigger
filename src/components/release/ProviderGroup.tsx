import type { ReleaseItem } from "@/types/digest";
import { ReleaseGrid } from "./ReleaseGrid";

interface ProviderGroupProps {
  provider: string;
  items: ReleaseItem[];
  linkBase?: string;
}

export function ProviderGroup({ provider, items, linkBase }: ProviderGroupProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{provider}</p>
      <ReleaseGrid items={items} linkBase={linkBase} />
    </div>
  );
}
