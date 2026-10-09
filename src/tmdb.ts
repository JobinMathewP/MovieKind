import { createTtlCache } from "./cache.js";
import { HttpError } from "./http.js";

const TMDB_BASE = "https://api.themoviedb.org/3";

/** TMDB movie genre ids. Names are stable and used when search results only send ids. */
const TMDB_GENRES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

type TmdbMovie = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  original_language?: string;
  genre_ids?: number[];
};

export type TmdbSearchHit = {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  originalLanguage: string | null;
  genreNames: string[];
};

type TmdbMovieDetails = {
  id: number;
  adult?: boolean;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  original_language?: string;
  genres?: Array<{ id?: number; name?: string }>;
  runtime?: number | null;
  overview?: string | null;
};

export type MappedTmdbMovie = {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  originalLanguage: string | null;
  genres: string[];
  runtimeMinutes: number | null;
  overview: string | null;
};

function yearFromReleaseDate(releaseDate: string | undefined): number | null {
  if (!releaseDate || releaseDate.length < 4) return null;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function posterPathOnly(value: string | null | undefined): string | null {
  const trimmed = blankToNull(value);
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const name = new URL(trimmed).pathname.split("/").filter(Boolean).pop();
      return name ? `/${name}` : null;
    } catch {
      return null;
    }
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function mapTmdbMovie(movie: TmdbMovie): TmdbSearchHit {
  const genreNames = (movie.genre_ids ?? []).flatMap((id) => {
    const name = TMDB_GENRES[id];
    return name ? [name] : [];
  });
  return {
    tmdbId: movie.id,
    title: movie.title?.trim() || movie.original_title?.trim() || "Untitled",
    originalTitle: movie.original_title?.trim() || null,
    year: yearFromReleaseDate(movie.release_date),
    posterPath: movie.poster_path?.trim() || null,
    originalLanguage: movie.original_language?.trim() || null,
    genreNames,
  };
}

export function mapTmdbMovieDetails(movie: TmdbMovieDetails): MappedTmdbMovie {
  const runtime = movie.runtime;
  return {
    tmdbId: movie.id,
    title: movie.title?.trim() || movie.original_title?.trim() || "Untitled",
    originalTitle: blankToNull(movie.original_title),
    year: yearFromReleaseDate(movie.release_date),
    posterPath: posterPathOnly(movie.poster_path),
    originalLanguage: blankToNull(movie.original_language),
    genres: (movie.genres ?? []).flatMap((genre) => {
      const name = genre.name?.trim();
      return name ? [name] : [];
    }),
    runtimeMinutes: runtime != null && Number.isInteger(runtime) && runtime >= 0 ? runtime : null,
    overview: blankToNull(movie.overview),
  };
}

const searchCache = createTtlCache<TmdbSearchHit[]>({ ttlMs: 10 * 60 * 1000, max: 200 });
const movieCache = createTtlCache<MappedTmdbMovie>({ ttlMs: 6 * 60 * 60 * 1000, max: 500 });

export async function fetchMovie(apiKey: string, tmdbId: number): Promise<MappedTmdbMovie> {
  const cached = movieCache.get(String(tmdbId));
  if (cached) return cached;

  let response: Response;
  try {
    response = await fetch(`${TMDB_BASE}/movie/${tmdbId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new HttpError(502, "TMDB request failed");
  }

  if (response.status === 404) throw new HttpError(404, "Film not found");
  if (!response.ok) throw new HttpError(502, "TMDB request failed");

  let payload: TmdbMovieDetails;
  try {
    payload = (await response.json()) as TmdbMovieDetails;
  } catch {
    throw new HttpError(502, "TMDB request failed");
  }
  if (payload.adult === true) throw new HttpError(400, "Adult films cannot be saved");
  const film = mapTmdbMovieDetails(payload);
  movieCache.set(String(tmdbId), film);
  return film;
}

export async function searchMovies(apiKey: string, query: string): Promise<TmdbSearchHit[]> {
  const cacheKey = query.trim().toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const url = new URL(`${TMDB_BASE}/search/movie`);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new HttpError(502, "TMDB search failed");
  }
  if (!response.ok) throw new HttpError(502, "TMDB search failed");

  const payload = (await response.json()) as { results?: TmdbMovie[] };
  const results = (payload.results ?? []).slice(0, 20).map(mapTmdbMovie);
  searchCache.set(cacheKey, results);
  return results;
}
