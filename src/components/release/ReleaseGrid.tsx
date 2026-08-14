import { type ReleaseItem, toMovie } from "@/types/digest";
import { PosterCard } from "./PosterCard";
import { useRatings } from "@/hooks/useRatings";
import { useWatchlistContext } from "@/contexts/WatchlistContext";

interface ReleaseGridProps {
  items: ReleaseItem[];
  linkBase?: string; // e.g. "/title" -> links to `${linkBase}/${mediaType}/${id}`
}

export function ReleaseGrid({ items, linkBase }: ReleaseGridProps) {
  // One cache-only batch request for the whole grid — no OMDb budget spent.
  const ratingFor = useRatings(items);
  const wl = useWatchlistContext();

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
      {items.map((item) => (
        <PosterCard
          key={`${item.mediaType}-${item.id}`}
          item={item}
          rating={ratingFor(item.mediaType, item.id)}
          linkTo={linkBase ? `${linkBase}/${item.mediaType}/${item.id}` : undefined}
          // The home digest previously rendered no add controls at all, so the
          // main page offered no way to save anything.
          onAddToWatchlist={() => wl.addToWatchlist(toMovie(item))}
          onAddToWatchLater={() => wl.addToWatchLater(toMovie(item))}
        />
      ))}
    </div>
  );
}
