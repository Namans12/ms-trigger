/** How a title is reaching its audience. `tv_network` is a linear-TV premiere
 * (HGTV, AMC, PBS) — neither a cinema release nor an OTT drop, and the case the
 * old boolean-only model got wrong for 154 of 267 shows. */
export type CalendarKind = "streaming" | "tv_network" | "theatrical";

export interface CalendarEntryDTO {
  releaseDate: string; // YYYY-MM-DD
  title: string;
  language: string | null;
  mediaType: "movie" | "tv" | null;
  kind: CalendarKind;
  /** Retained as a convenience alias for `kind === "theatrical"`. */
  isTheatrical: boolean;
  platform: string | null;
  tmdbId: number | null;
  posterUrl: string | null;
  rating: number | null;
  overview: string | null;
  origin: "tmdb" | "csv_seed";
}
