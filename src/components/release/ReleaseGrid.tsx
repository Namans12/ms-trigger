import type { ReleaseItem } from "@/types/digest";
import { PosterCard } from "./PosterCard";

interface ReleaseGridProps {
  items: ReleaseItem[];
  linkBase?: string; // e.g. "/title" -> links to `${linkBase}/${mediaType}/${id}`
}

export function ReleaseGrid({ items, linkBase }: ReleaseGridProps) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
      {items.map((item) => (
        <PosterCard
          key={`${item.mediaType}-${item.id}`}
          item={item}
          linkTo={linkBase ? `${linkBase}/${item.mediaType}/${item.id}` : undefined}
        />
      ))}
    </div>
  );
}
