import type { Express, Response } from "express";
import { z } from "zod";
import { getContext } from "../auth.js";
import { assertDb, asyncHandler, HttpError } from "../http.js";
import { displayNames, parseUuid, sameId, unique } from "../ids.js";
import { audit } from "../log.js";

const profileBody = z.object({
  displayName: z.string().trim().min(1).max(80),
  languages: z
    .array(z.string().trim().regex(/^[a-zA-Z]{2,3}$/, "Use a 2 or 3 letter language code"))
    .max(20),
});

type ProfileRow = {
  id: string;
  display_name: string;
  languages: string[] | null;
  created_at: string;
};

function mapProfile(row: ProfileRow) {
  return {
    id: row.id,
    displayName: row.display_name,
    languages: row.languages ?? [],
    createdAt: row.created_at,
  };
}

function normalizeLanguages(codes: string[]): string[] {
  const seen = new Set<string>();
  const languages: string[] = [];
  for (const code of codes) {
    const normalized = code.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    languages.push(normalized);
  }
  return languages;
}

async function requireProfile(res: Response, userId: string): Promise<ProfileRow> {
  const { supabase } = getContext(res);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, languages, created_at")
    .eq("id", userId)
    .maybeSingle();
  assertDb(error);
  if (!data) throw new HttpError(404, "Profile not found");
  return data as ProfileRow;
}

export function registerProfileRoutes(app: Express): void {
  app.get(
    "/me",
    asyncHandler(async (_req, res) => {
      const { userId } = getContext(res);
      const profile = await requireProfile(res, userId);
      res.json(mapProfile(profile));
    }),
  );

  app.put(
    "/me",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const body = profileBody.parse(req.body);
      const { data, error } = await supabase
        .from("profiles")
        .upsert(
          {
            id: userId,
            display_name: body.displayName,
            languages: normalizeLanguages(body.languages),
          },
          { onConflict: "id" },
        )
        .select("id, display_name, languages, created_at")
        .single();
      assertDb(error);
      audit(res, "profile.upsert", userId);
      res.json(mapProfile(data as ProfileRow));
    }),
  );

  app.delete(
    "/me",
    asyncHandler(async (_req, res) => {
      const { userId, supabase } = getContext(res);
      const { error } = await supabase.rpc("delete_own_account");
      if (error?.code === "PGRST202") throw new HttpError(500, "Account deletion is not available");
      assertDb(error);
      audit(res, "account.delete", userId);
      res.status(204).end();
    }),
  );

  app.get(
    "/users/:id",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const id = parseUuid(req.params.id, "user id");
      const profile = await requireProfile(res, id);

      const [followers, following, followed] = await Promise.all([
        supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", id),
        supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", id),
        supabase
          .from("follows")
          .select("follower_id")
          .eq("follower_id", userId)
          .eq("following_id", id)
          .maybeSingle(),
      ]);
      assertDb(followers.error);
      assertDb(following.error);
      assertDb(followed.error);

      res.json({
        id: profile.id,
        displayName: profile.display_name,
        languages: profile.languages ?? [],
        followerCount: followers.count ?? 0,
        followingCount: following.count ?? 0,
        followedByMe: Boolean(followed.data) && !sameId(userId, id),
      });
    }),
  );

  app.get(
    "/users/:id/reviews",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const id = parseUuid(req.params.id, "user id");
      await requireProfile(res, id);
      res.json(await reviewsFor(res, id));
    }),
  );

  app.get(
    "/me/reviews",
    asyncHandler(async (_req, res) => {
      const { userId } = getContext(res);
      res.json(await reviewsFor(res, userId));
    }),
  );

  app.post(
    "/follows/:userId",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const targetId = parseUuid(req.params.userId, "user id");
      if (sameId(userId, targetId)) throw new HttpError(400, "You cannot follow yourself");
      await requireProfile(res, targetId);

      const { error } = await supabase.from("follows").insert({
        follower_id: userId,
        following_id: targetId,
      });
      if (error?.code === "23505") {
        audit(res, "follow", targetId);
        res.status(204).end();
        return;
      }
      assertDb(error);
      audit(res, "follow", targetId);
      res.status(204).end();
    }),
  );

  app.delete(
    "/follows/:userId",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const targetId = parseUuid(req.params.userId, "user id");
      if (sameId(userId, targetId)) throw new HttpError(400, "You cannot follow yourself");
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", userId)
        .eq("following_id", targetId);
      assertDb(error);
      audit(res, "unfollow", targetId);
      res.status(204).end();
    }),
  );

  app.get(
    "/me/following",
    asyncHandler(async (_req, res) => {
      const { userId, supabase } = getContext(res);
      const { data, error } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", userId)
        .order("created_at", { ascending: false });
      assertDb(error);
      const ids = unique((data ?? []).map((row) => row.following_id as string));
      const names = await displayNames(supabase, ids);
      res.json(ids.flatMap((id) => {
        const displayName = names.get(id);
        return displayName ? [{ id, displayName }] : [];
      }));
    }),
  );

  app.get(
    "/me/followers",
    asyncHandler(async (_req, res) => {
      const { userId, supabase } = getContext(res);
      const { data, error } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("following_id", userId)
        .order("created_at", { ascending: false });
      assertDb(error);
      const ids = unique((data ?? []).map((row) => row.follower_id as string));
      const names = await displayNames(supabase, ids);
      res.json(ids.flatMap((id) => {
        const displayName = names.get(id);
        return displayName ? [{ id, displayName }] : [];
      }));
    }),
  );
}

type ReviewJoined = {
  id: string;
  tmdb_id: number;
  rating: number | null;
  body: string | null;
  created_at: string;
  updated_at: string;
  films:
    | {
        tmdb_id: number;
        title: string;
        year: number | null;
        poster_path: string | null;
        genres: string[] | null;
      }
    | Array<{
        tmdb_id: number;
        title: string;
        year: number | null;
        poster_path: string | null;
        genres: string[] | null;
      }>
    | null;
};

export function mapReview(row: ReviewJoined) {
  const film = Array.isArray(row.films) ? (row.films[0] ?? null) : row.films;
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    rating: row.rating,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    film: {
      tmdbId: film?.tmdb_id ?? row.tmdb_id,
      title: film?.title ?? "",
      year: film?.year ?? null,
      posterPath: film?.poster_path ?? null,
      genres: film?.genres ?? [],
    },
  };
}

async function reviewsFor(res: Response, userId: string) {
  const { supabase } = getContext(res);
  const { data, error } = await supabase
    .from("reviews")
    .select("id, tmdb_id, rating, body, created_at, updated_at, films (tmdb_id, title, year, poster_path, genres)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  assertDb(error);
  return ((data ?? []) as ReviewJoined[]).map(mapReview);
}
