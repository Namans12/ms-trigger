export interface CalendarEntryDTO {
  releaseDate: string; // YYYY-MM-DD
  title: string;
  language: string | null;
  mediaType: "movie" | "tv" | null;
  isTheatrical: boolean;
  platform: string | null;
  tmdbId: number | null;
  posterUrl: string | null;
  rating: number | null;
  overview: string | null;
  origin: "tmdb" | "csv_seed";
}
