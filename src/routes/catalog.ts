import type { Express } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getContext } from "../auth.js";
import type { AppConfig } from "../config.js";
import { assertDb, asyncHandler, HttpError } from "../http.js";
import { parseTmdbIdParam, tmdbIdSchema } from "../ids.js";
import { mapReview } from "./profiles.js";
import { fetchMovie, searchMovies, type MappedTmdbMovie } from "../tmdb.js";
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

export function registerCatalogRoutes(app: Express, config: AppConfig): void {
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
