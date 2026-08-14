import type { ReleaseItem } from "@/types/digest";
import { ReleaseCard } from "./ReleaseCard";

interface ReleaseGridProps {
  items: ReleaseItem[];
  linkBase?: string; // e.g. "/title" -> links to `${linkBase}/${mediaType}/${id}`
}

export function ReleaseGrid({ items, linkBase }: ReleaseGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((item) => (
        <ReleaseCard
          key={`${item.mediaType}-${item.id}`}
          item={item}
          showActions={false}
          linkTo={linkBase ? `${linkBase}/${item.mediaType}/${item.id}` : undefined}
        />
      ))}
    </div>
  );
}
