export type DeckFilm = {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  originalLanguage: string | null;
  genreNames: string[];
};

export type LovedRow = {
  tmdbId: number;
  rating: number;
  film: DeckFilm;
};

/**
 * Films people already loved come first, ranked by how many loves, then average rating.
 * Discovery only fills the remaining slots. Excluded ids and films with no poster never return.
 */
export function pickPopularFilms(
  loved: readonly LovedRow[],
  discovered: readonly DeckFilm[],
  exclude: ReadonlySet<number>,
  limit: number,
): DeckFilm[] {
  const groups = new Map<number, { film: DeckFilm; count: number; sum: number }>();
  for (const row of loved) {
    if (!row.film.posterPath || exclude.has(row.tmdbId)) continue;
    const current = groups.get(row.tmdbId);
    if (current) {
      current.count += 1;
      current.sum += row.rating;
    } else {
      groups.set(row.tmdbId, { film: row.film, count: 1, sum: row.rating });
    }
  }

  const ranked = [...groups.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const averageGap = b.sum / b.count - a.sum / a.count;
    if (averageGap !== 0) return averageGap;
    return a.film.tmdbId - b.film.tmdbId;
  });

  const chosen = new Set<number>(exclude);
  const result: DeckFilm[] = [];
  for (const row of ranked) {
    if (result.length >= limit) return result;
    if (chosen.has(row.film.tmdbId)) continue;
    chosen.add(row.film.tmdbId);
    result.push(row.film);
  }
  for (const film of discovered) {
    if (result.length >= limit) return result;
    if (!film.posterPath || chosen.has(film.tmdbId)) continue;
    chosen.add(film.tmdbId);
    result.push(film);
  }
  return result;
}
