import type { Express } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getContext } from "../auth.js";
import type { AppConfig } from "../config.js";
import { assertDb, asyncHandler, HttpError } from "../http.js";
import { parseTmdbIdParam, tmdbIdSchema } from "../ids.js";
import { mapReview } from "./profiles.js";
import { pickPopularFilms, type DeckFilm, type LovedRow } from "../popular.js";
import { discoverMovies, fetchMovie, searchMovies, type MappedTmdbMovie, type TmdbSearchHit } from "../tmdb.js";
import { audit } from "../log.js";

const filmBody = z
  .object({
    tmdbId: tmdbIdSchema,
  })
  .strict();

const reviewBody = z
  .object({
    tmdbId: tmdbIdSchema,
    rating: z.number().int().min(1).max(5).nullable(),
    body: z.string().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const text = value.body?.trim() ?? "";
    if (text.length > 0 && value.rating == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: "A review needs a rating",
      });
    }
  });

type FilmRow = {
  tmdb_id: number;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_path: string | null;
  original_language: string | null;
  genres: string[] | null;
  runtime_minutes: number | null;
  overview: string | null;
  fetched_at: string;
};

function mapFilm(row: FilmRow) {
  return {
    tmdbId: row.tmdb_id,
    title: row.title,
    originalTitle: row.original_title,
    year: row.year,
    posterPath: row.poster_path,
    originalLanguage: row.original_language,
    genres: row.genres ?? [],
    runtimeMinutes: row.runtime_minutes,
    overview: row.overview,
    fetchedAt: row.fetched_at,
  };
}

async function readFilm(supabase: SupabaseClient, tmdbId: number): Promise<FilmRow | null> {
  const { data, error } = await supabase.from("films").select("*").eq("tmdb_id", tmdbId).maybeSingle();
  assertDb(error);
  return (data as FilmRow | null) ?? null;
}

async function saveFilm(supabase: SupabaseClient, film: MappedTmdbMovie): Promise<FilmRow> {
  const { data, error } = await supabase
    .from("films")
    .upsert(
      {
        tmdb_id: film.tmdbId,
        title: film.title,
        original_title: film.originalTitle,
        year: film.year,
        poster_path: film.posterPath,
        original_language: film.originalLanguage,
        genres: film.genres,
        runtime_minutes: film.runtimeMinutes,
        overview: film.overview,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "tmdb_id", defaultToNull: false },
    )
    .select("*")
    .single();
  assertDb(error);
  return data as FilmRow;
}

const MAX_EXCLUDE = 100;

function parseLanguage(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-zA-Z]{2,3}$/.test(raw)) throw new HttpError(400, "Invalid language");
  return raw.toLowerCase();
}

function parseLimit(raw: unknown): number {
  if (raw == null || raw === "") return 10;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new HttpError(400, "Invalid limit");
  const limit = Number(raw);
  if (limit < 1 || limit > 20) throw new HttpError(400, "Invalid limit");
  return limit;
}

function parseExclude(raw: unknown): Set<number> {
  if (raw == null || raw === "") return new Set();
  if (typeof raw !== "string") throw new HttpError(400, "Invalid exclude list");
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length > MAX_EXCLUDE) throw new HttpError(400, "Too many films to exclude");
  const ids = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) throw new HttpError(400, "Invalid exclude list");
    const id = Number(part);
    if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) throw new HttpError(400, "Invalid exclude list");
    ids.add(id);
  }
  return ids;
}

type LovedFilmRow = {
  tmdb_id: number;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_path: string | null;
  original_language: string | null;
  genres: string[] | null;
};

function oneFilm(value: LovedFilmRow | LovedFilmRow[] | null): LovedFilmRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toDeckFilm(row: LovedFilmRow): DeckFilm {
  return {
    tmdbId: row.tmdb_id,
    title: row.title,
    originalTitle: row.original_title,
    year: row.year,
    posterPath: row.poster_path,
    originalLanguage: row.original_language,
    genreNames: row.genres ?? [],
  };
}

function fromSearchHit(hit: TmdbSearchHit): DeckFilm {
  return {
    tmdbId: hit.tmdbId,
    title: hit.title,
    originalTitle: hit.originalTitle,
    year: hit.year,
    posterPath: hit.posterPath,
    originalLanguage: hit.originalLanguage,
    genreNames: hit.genreNames,
  };
}

async function lovedInLanguage(supabase: SupabaseClient, language: string): Promise<LovedRow[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("tmdb_id, rating, films!inner(tmdb_id, title, original_title, year, poster_path, original_language, genres)")
    .gte("rating", 4)
    .eq("films.original_language", language)
    .limit(1000);
  assertDb(error);
  const rows: LovedRow[] = [];
  for (const row of data ?? []) {
    const record = row as { tmdb_id: number; rating: number | null; films: LovedFilmRow | LovedFilmRow[] | null };
    const film = oneFilm(record.films);
    if (!film || record.rating == null) continue;
    rows.push({ tmdbId: record.tmdb_id, rating: record.rating, film: toDeckFilm(film) });
  }
  return rows;
}

export function registerCatalogRoutes(app: Express, config: AppConfig): void {
  app.get(
    "/films/popular",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const language = parseLanguage(req.query.language);
      const limit = parseLimit(req.query.limit);
      const exclude = parseExclude(req.query.exclude);
      const loved = await lovedInLanguage(supabase, language);
      const local = pickPopularFilms(loved, [], exclude, limit);
      let discovered: DeckFilm[] = [];
      if (local.length < limit) {
        const firstPage = await discoverMovies(config.tmdbApiKey, language, 1);
        const secondPage = local.length + firstPage.length < limit ? await discoverMovies(config.tmdbApiKey, language, 2) : [];
        discovered = [...firstPage, ...secondPage]
          .map(fromSearchHit)
          .filter((film) => film.originalLanguage?.toLowerCase() === language);
      }
      res.json(pickPopularFilms(loved, discovered, exclude, limit));
    }),
  );

  app.get(
    "/films/search",
    asyncHandler(async (req, res) => {
      const query = req.query.q;
      if (typeof query !== "string" || query.trim().length === 0) {
        throw new HttpError(400, "Query is required");
      }
      if (query.trim().length > 200) throw new HttpError(400, "Query is too long");
      const results = await searchMovies(config.tmdbApiKey, query.trim());
      res.json(results);
    }),
  );

  app.post(
    "/films",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const body = filmBody.parse(req.body);
      const film = await fetchMovie(config.tmdbApiKey, body.tmdbId);
      const saved = await saveFilm(supabase, film);
      audit(res, "film.save", String(saved.tmdb_id));
      res.json(mapFilm(saved));
    }),
  );

  app.put(
    "/reviews",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const body = reviewBody.parse(req.body);
      const film = await readFilm(supabase, body.tmdbId);
      if (!film) throw new HttpError(400, "Film not found");

      const text = body.body?.trim() ?? "";
      const review = {
        user_id: userId,
        tmdb_id: body.tmdbId,
        rating: body.rating,
        body: text.length > 0 ? text : null,
        updated_at: new Date().toISOString(),
      };

      const { data: existing, error: existingError } = await supabase
        .from("reviews")
        .select("id")
        .eq("user_id", userId)
        .eq("tmdb_id", body.tmdbId)
        .maybeSingle();
      assertDb(existingError);

      const write = existing
        ? supabase.from("reviews").update(review).eq("id", existing.id)
        : supabase.from("reviews").insert(review);

      const { data, error } = await write
        .select("id, tmdb_id, rating, body, created_at, updated_at, films (tmdb_id, title, year, poster_path, genres)")
        .single();
      assertDb(error);
      audit(res, "review.upsert", String(body.tmdbId));
      res.json(mapReview(data as Parameters<typeof mapReview>[0]));
    }),
  );

  app.delete(
    "/reviews/:tmdbId",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const tmdbId = parseTmdbIdParam(req.params.tmdbId);
      const { error } = await supabase.from("reviews").delete().eq("user_id", userId).eq("tmdb_id", tmdbId);
      assertDb(error);
      audit(res, "review.delete", String(tmdbId));
      res.status(204).end();
    }),
  );
}
