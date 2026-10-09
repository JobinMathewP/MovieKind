import type { Express } from "express";
import { z } from "zod";
import { getContext } from "../auth.js";
import { assertDb, asyncHandler, HttpError } from "../http.js";
import { displayNames, tmdbIdSchema, unique } from "../ids.js";
import { isLikedRating, rankRecommendations, type RankFilm, type RankReview } from "../recommend.js";

const recommendationBody = z
  .object({
    tmdbIds: z.array(tmdbIdSchema).min(2).max(5),
    followersOnly: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.tmdbIds).size !== value.tmdbIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tmdbIds"],
        message: "Film ids must be unique",
      });
    }
  });

type ReviewRow = {
  user_id: string;
  tmdb_id: number;
  rating: number | null;
};

type FilmRow = {
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  genres: string[] | null;
  original_language: string | null;
};

export function registerRecommendationRoutes(app: Express): void {
  app.post(
    "/recommendations",
    asyncHandler(async (req, res) => {
      const { userId, supabase } = getContext(res);
      const body = recommendationBody.parse(req.body);
      const followersOnly = body.followersOnly ?? false;

      const { data: mine, error: mineError } = await supabase
        .from("reviews")
        .select("user_id, tmdb_id, rating")
        .eq("user_id", userId);
      assertDb(mineError);
      const myReviews = (mine ?? []) as ReviewRow[];
      const myRatings = new Map(myReviews.map((review) => [review.tmdb_id, review.rating]));
      const seedsAreLikes = body.tmdbIds.every((tmdbId) => isLikedRating(myRatings.get(tmdbId) ?? null));
      if (!seedsAreLikes) {
        throw new HttpError(400, "Each film must be one you rated 4 or 5");
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("languages")
        .eq("id", userId)
        .maybeSingle();
      assertDb(profileError);
      const languages = ((profile?.languages as string[] | null) ?? []).filter((code) => code.length > 0);

      let followingIds: string[] = [];
      if (followersOnly) {
        const { data: follows, error: followsError } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", userId);
        assertDb(followsError);
        followingIds = unique((follows ?? []).map((row) => row.following_id as string));
      }
      const following = new Set(followingIds);

      const { data: seedRows, error: seedError } = await supabase
        .from("reviews")
        .select("user_id, tmdb_id, rating")
        .in("tmdb_id", body.tmdbIds)
        .neq("user_id", userId);
      assertDb(seedError);

      const matcherIds = unique(
        ((seedRows ?? []) as ReviewRow[]).flatMap((review) => {
          if (!isLikedRating(review.rating)) return [];
          if (followersOnly && !following.has(review.user_id)) return [];
          return [review.user_id];
        }),
      );

      let matcherReviews: ReviewRow[] = [];
      if (matcherIds.length > 0) {
        const { data, error } = await supabase
          .from("reviews")
          .select("user_id, tmdb_id, rating")
          .in("user_id", matcherIds);
        assertDb(error);
        matcherReviews = (data ?? []) as ReviewRow[];
      }

      const names = await displayNames(supabase, matcherIds);
      const reviews: RankReview[] = [
        ...myReviews.map((review) => ({
          userId,
          displayName: "",
          tmdbId: review.tmdb_id,
          rating: review.rating,
        })),
        ...matcherReviews.map((review) => ({
          userId: review.user_id,
          displayName: names.get(review.user_id) ?? "",
          tmdbId: review.tmdb_id,
          rating: review.rating,
        })),
      ];

      const filmIds = unique(reviews.map((review) => String(review.tmdbId))).map(Number);
      let films: RankFilm[] = [];
      if (filmIds.length > 0) {
        const { data, error } = await supabase
          .from("films")
          .select("tmdb_id, title, year, poster_path, genres, original_language")
          .in("tmdb_id", filmIds);
        assertDb(error);
        films = ((data ?? []) as FilmRow[]).map((film) => ({
          tmdbId: film.tmdb_id,
          title: film.title,
          year: film.year,
          posterPath: film.poster_path,
          genres: film.genres ?? [],
          originalLanguage: film.original_language,
        }));
      }

      res.json(
        rankRecommendations({
          callerId: userId,
          seedTmdbIds: body.tmdbIds,
          reviews,
          films,
          languages,
          followingIds,
          followersOnly,
        }),
      );
    }),
  );
}
