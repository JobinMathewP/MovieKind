/** A like is a rating of 4 or 5. Null means seen and is not a like. */
export const LIKE_RATING = 4;

export type RankReview = {
  userId: string;
  displayName: string;
  tmdbId: number;
  rating: number | null;
};

export type RankFilm = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  genres: string[];
  originalLanguage: string | null;
};

export type RankedFilm = {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  genres: string[];
  originalLanguage: string | null;
  likedByCount: number;
  averageRating: number;
  matchNames: string[];
  matchCount: number;
};

export type RankInput = {
  callerId: string;
  seedTmdbIds: number[];
  reviews: RankReview[];
  films: RankFilm[];
  languages: string[];
  followingIds: readonly string[];
  followersOnly: boolean;
  limit?: number;
};

export function isLikedRating(rating: number | null): rating is number {
  return rating != null && rating >= LIKE_RATING;
}

function averageRating(ratings: number[]): number {
  const sum = ratings.reduce((total, rating) => total + rating, 0);
  return Math.round((sum / ratings.length) * 100) / 100;
}

/**
 * People who rated the seed films 4 or 5, then films those people rated 4 or 5.
 * The caller's review rows (including seen-only) are excluded.
 * Rank is liked-by count, then average rating, then the caller's languages.
 */
export function rankRecommendations(input: RankInput): RankedFilm[] {
  const seedIds = new Set(input.seedTmdbIds);
  const following = new Set(input.followingIds);
  const excluded = new Set<number>(seedIds);
  const filmsById = new Map(input.films.map((film) => [film.tmdbId, film]));

  for (const review of input.reviews) {
    if (review.userId === input.callerId) excluded.add(review.tmdbId);
  }

  const matchedUserIds = new Set<string>();
  for (const review of input.reviews) {
    if (review.userId === input.callerId) continue;
    if (!seedIds.has(review.tmdbId)) continue;
    if (!isLikedRating(review.rating)) continue;
    if (input.followersOnly && !following.has(review.userId)) continue;
    matchedUserIds.add(review.userId);
  }

  const likesByFilm = new Map<number, Map<string, { displayName: string; rating: number }>>();
  for (const review of input.reviews) {
    if (!matchedUserIds.has(review.userId)) continue;
    if (!isLikedRating(review.rating)) continue;
    if (excluded.has(review.tmdbId)) continue;

    let people = likesByFilm.get(review.tmdbId);
    if (!people) {
      people = new Map();
      likesByFilm.set(review.tmdbId, people);
    }
    const current = people.get(review.userId);
    if (!current || review.rating > current.rating) {
      people.set(review.userId, {
        displayName: review.displayName,
        rating: review.rating,
      });
    }
  }

  const languages = new Set(input.languages.map((code) => code.toLowerCase()));
  const preferLanguage = languages.size > 0;

  const ranked = [...likesByFilm.entries()].flatMap(([tmdbId, people]) => {
    const film = filmsById.get(tmdbId);
    if (!film) return [];
    const likers = [...people.values()].sort(
      (a, b) => b.rating - a.rating || a.displayName.localeCompare(b.displayName),
    );
    const languageRank =
      preferLanguage && film.originalLanguage && languages.has(film.originalLanguage.toLowerCase())
        ? 1
        : 0;
    return [
      {
        tmdbId: film.tmdbId,
        title: film.title,
        year: film.year,
        posterPath: film.posterPath,
        genres: film.genres,
        originalLanguage: film.originalLanguage,
        likedByCount: likers.length,
        averageRating: averageRating(likers.map((person) => person.rating)),
        matchNames: likers.slice(0, 4).map((person) => person.displayName),
        matchCount: likers.length,
        languageRank,
      },
    ];
  });

  ranked.sort(
    (a, b) =>
      b.likedByCount - a.likedByCount ||
      b.averageRating - a.averageRating ||
      b.languageRank - a.languageRank ||
      a.tmdbId - b.tmdbId,
  );

  return ranked.slice(0, input.limit ?? 20).map(({ languageRank: _languageRank, ...film }) => film);
}
