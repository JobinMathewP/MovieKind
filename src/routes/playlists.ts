import type { Express, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getContext } from "../auth.js";
import { assertDb, asyncHandler, HttpError } from "../http.js";
import { parseTmdbIdParam, parseUuid, sameId, tmdbIdSchema } from "../ids.js";
import { audit } from "../log.js";

const createPlaylistBody = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  isPublic: z.boolean().optional(),
});

const patchPlaylistBody = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    isPublic: z.boolean().optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.description !== undefined || value.isPublic !== undefined,
    { message: "No changes" },
  );

const playlistFilmBody = z.object({
  tmdbId: tmdbIdSchema,
  position: z.number().int().min(0).max(100_000),
});

type PlaylistRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type PlaylistFilmRow = {
  tmdb_id: number;
  position: number;
  films:
    | {
        title: string;
        year: number | null;
        poster_path: string | null;
        genres: string[] | null;
        original_language: string | null;
      }
    | Array<{
        title: string;
        year: number | null;
        poster_path: string | null;
        genres: string[] | null;
        original_language: string | null;
      }>
    | null;
};

function mapPlaylist(row: PlaylistRow) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function descriptionOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadPlaylist(supabase: SupabaseClient, id: string): Promise<PlaylistRow | null> {
  const { data, error } = await supabase.from("playlists").select("*").eq("id", id).maybeSingle();
  assertDb(error);
  return (data as PlaylistRow | null) ?? null;
}

async function requireOwner(res: Response, playlistId: string): Promise<PlaylistRow> {
  const { userId, supabase } = getContext(res);
  const playlist = await loadPlaylist(supabase, playlistId);
  if (!playlist) throw new HttpError(404, "Playlist not found");
  if (!sameId(playlist.user_id, userId)) {
    throw new HttpError(403, "Only the owner can change this playlist");
  }
  return playlist;
}

async function countsFor(supabase: SupabaseClient, playlistIds: string[]) {
  const filmCounts = new Map<string, number>();
  const likeCounts = new Map<string, number>();
  if (playlistIds.length === 0) return { filmCounts, likeCounts };

  const [films, likes] = await Promise.all([
    supabase.from("playlist_films").select("playlist_id").in("playlist_id", playlistIds),
    supabase.from("playlist_likes").select("playlist_id").in("playlist_id", playlistIds),
  ]);
  assertDb(films.error);
  assertDb(likes.error);
  for (const row of films.data ?? []) {
    const id = row.playlist_id as string;
    filmCounts.set(id, (filmCounts.get(id) ?? 0) + 1);
  }
  for (const row of likes.data ?? []) {
    const id = row.playlist_id as string;
    likeCounts.set(id, (likeCounts.get(id) ?? 0) + 1);
  }
  return { filmCounts, likeCounts };
}

function withCounts(
  rows: PlaylistRow[],
  filmCounts: Map<string, number>,
  likeCounts: Map<string, number>,
) {
  return rows.map((row) => ({
    ...mapPlaylist(row),
    filmCount: filmCounts.get(row.id) ?? 0,
    likeCount: likeCounts.get(row.id) ?? 0,
  }));
}

function mapPlaylistFilm(row: PlaylistFilmRow) {
  const film = Array.isArray(row.films) ? (row.films[0] ?? null) : row.films;
  return {
    tmdbId: row.tmdb_id,
    position: row.position,
    title: film?.title ?? "",
    year: film?.year ?? null,
    posterPath: film?.poster_path ?? null,
    genres: film?.genres ?? [],
    originalLanguage: film?.original_language ?? null,
  };
}

export function registerPlaylistRoutes(app: Express): void {
  app.post(
    "/playlists",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const body = createPlaylistBody.parse(req.body);
      const { data, error } = await supabase
        .from("playlists")
        .insert({
          user_id: userId,
          title: body.title,
          description: descriptionOrNull(body.description),
          is_public: body.isPublic ?? false,
        })
        .select("*")
        .single();
      assertDb(error);
      const playlist = data as PlaylistRow;
      audit(res, "playlist.create", playlist.id);
      res.status(201).json(mapPlaylist(playlist));
    }),
  );

  app.patch(
    "/playlists/:id",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const id = parseUuid(req.params.id, "playlist id");
      await requireOwner(res, id);
      const body = patchPlaylistBody.parse(req.body);
      const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.title !== undefined) changes.title = body.title;
      if (body.description !== undefined) changes.description = descriptionOrNull(body.description);
      if (body.isPublic !== undefined) changes.is_public = body.isPublic;

      const { data, error } = await supabase
        .from("playlists")
        .update(changes)
        .eq("id", id)
        .select("*")
        .single();
      assertDb(error);
      audit(res, "playlist.update", id);
      res.json(mapPlaylist(data as PlaylistRow));
    }),
  );

  app.delete(
    "/playlists/:id",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const id = parseUuid(req.params.id, "playlist id");
      await requireOwner(res, id);
      const { error } = await supabase.from("playlists").delete().eq("id", id);
      assertDb(error);
      audit(res, "playlist.delete", id);
      res.status(204).end();
    }),
  );

  app.get(
    "/me/playlists",
    asyncHandler(async (_req, res) => {
      const { userId, supabase } = getContext(res);
      const { data, error } = await supabase
        .from("playlists")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      assertDb(error);
      const rows = (data ?? []) as PlaylistRow[];
      const { filmCounts, likeCounts } = await countsFor(
        supabase,
        rows.map((row) => row.id),
      );
      res.json(withCounts(rows, filmCounts, likeCounts));
    }),
  );

  app.get(
    "/users/:id/playlists",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const id = parseUuid(req.params.id, "user id");
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      assertDb(profileError);
      if (!profile) throw new HttpError(404, "Profile not found");

      const { data, error } = await supabase
        .from("playlists")
        .select("*")
        .eq("user_id", id)
        .eq("is_public", true)
        .order("updated_at", { ascending: false });
      assertDb(error);
      const rows = (data ?? []) as PlaylistRow[];
      const { filmCounts, likeCounts } = await countsFor(
        supabase,
        rows.map((row) => row.id),
      );
      res.json(withCounts(rows, filmCounts, likeCounts));
    }),
  );

  app.get(
    "/playlists/:id",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const id = parseUuid(req.params.id, "playlist id");
      const playlist = await loadPlaylist(supabase, id);
      if (!playlist) throw new HttpError(404, "Playlist not found");

      const [filmsResult, likesResult, mineResult] = await Promise.all([
        supabase
          .from("playlist_films")
          .select(
            "tmdb_id, position, films (title, year, poster_path, genres, original_language)",
          )
          .eq("playlist_id", id)
          .order("position", { ascending: true })
          .order("added_at", { ascending: true }),
        supabase.from("playlist_likes").select("user_id").eq("playlist_id", id),
        supabase
          .from("playlist_likes")
          .select("user_id")
          .eq("playlist_id", id)
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      assertDb(filmsResult.error);
      assertDb(likesResult.error);
      assertDb(mineResult.error);

      res.json({
        ...mapPlaylist(playlist),
        filmCount: (filmsResult.data ?? []).length,
        likeCount: (likesResult.data ?? []).length,
        likedByMe: Boolean(mineResult.data),
        films: ((filmsResult.data ?? []) as PlaylistFilmRow[]).map(mapPlaylistFilm),
      });
    }),
  );

  app.post(
    "/playlists/:id/films",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const id = parseUuid(req.params.id, "playlist id");
      await requireOwner(res, id);
      const body = playlistFilmBody.parse(req.body);

      const { data: film, error: filmError } = await supabase
        .from("films")
        .select("tmdb_id, title, year, poster_path, genres, original_language")
        .eq("tmdb_id", body.tmdbId)
        .maybeSingle();
      assertDb(filmError);
      if (!film) throw new HttpError(400, "Film not found");

      const { data: existing, error: existingError } = await supabase
        .from("playlist_films")
        .select("tmdb_id")
        .eq("playlist_id", id)
        .eq("tmdb_id", body.tmdbId)
        .maybeSingle();
      assertDb(existingError);

      const write = existing
        ? supabase
            .from("playlist_films")
            .update({ position: body.position })
            .eq("playlist_id", id)
            .eq("tmdb_id", body.tmdbId)
        : supabase.from("playlist_films").insert({
            playlist_id: id,
            tmdb_id: body.tmdbId,
            position: body.position,
          });
      const { error } = await write;
      assertDb(error);
      audit(res, "playlist.film.save", `${id}:${body.tmdbId}`);

      const saved = film as {
        tmdb_id: number;
        title: string;
        year: number | null;
        poster_path: string | null;
        genres: string[] | null;
        original_language: string | null;
      };
      res.status(existing ? 200 : 201).json({
        tmdbId: saved.tmdb_id,
        position: body.position,
        title: saved.title,
        year: saved.year,
        posterPath: saved.poster_path,
        genres: saved.genres ?? [],
        originalLanguage: saved.original_language,
      });
    }),
  );

  app.delete(
    "/playlists/:id/films/:tmdbId",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const id = parseUuid(req.params.id, "playlist id");
      const tmdbId = parseTmdbIdParam(req.params.tmdbId);
      await requireOwner(res, id);
      const { error } = await supabase
        .from("playlist_films")
        .delete()
        .eq("playlist_id", id)
        .eq("tmdb_id", tmdbId);
      assertDb(error);
      audit(res, "playlist.film.delete", `${id}:${tmdbId}`);
      res.status(204).end();
    }),
  );

  app.post(
    "/playlists/:id/like",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const id = parseUuid(req.params.id, "playlist id");
      const playlist = await loadPlaylist(supabase, id);
      if (!playlist) throw new HttpError(404, "Playlist not found");
      if (!playlist.is_public) throw new HttpError(403, "Only public playlists can be liked");

      const { error } = await supabase.from("playlist_likes").insert({
        user_id: userId,
        playlist_id: id,
      });
      if (error?.code !== "23505") assertDb(error);
      audit(res, "playlist.like", id);
      res.status(204).end();
    }),
  );

  app.delete(
    "/playlists/:id/like",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const id = parseUuid(req.params.id, "playlist id");
      const { error } = await supabase
        .from("playlist_likes")
        .delete()
        .eq("user_id", userId)
        .eq("playlist_id", id);
      assertDb(error);
      audit(res, "playlist.unlike", id);
      res.status(204).end();
    }),
  );
}
