import type { Express } from "express";
import { z } from "zod";
import { getContext } from "../auth.js";
import { assertDb, asyncHandler, HttpError } from "../http.js";
import { tmdbIdSchema } from "../ids.js";
import { audit } from "../log.js";

const filmSourceBody = z.object({
  platform: z.enum(["netflix", "primevideo", "hotstar"]),
  contentId: z.string().trim().min(1).max(200),
  tmdbId: tmdbIdSchema,
});

export function registerFilmSourceRoutes(app: Express): void {
  app.post(
    "/film-sources",
    asyncHandler(async (req, res) => {
      const { supabase } = getContext(res);
      const body = filmSourceBody.parse(req.body);

      const { data: film, error: filmError } = await supabase
        .from("films")
        .select("tmdb_id")
        .eq("tmdb_id", body.tmdbId)
        .maybeSingle();
      assertDb(filmError);
      if (!film) throw new HttpError(400, "Film not found");

      const { data, error } = await supabase
        .from("film_sources")
        .upsert(
          {
            platform: body.platform,
            content_id: body.contentId,
            tmdb_id: body.tmdbId,
          },
          { onConflict: "platform,content_id" },
        )
        .select("platform, content_id, tmdb_id")
        .single();
      assertDb(error);
      const row = data as { platform: string; content_id: string; tmdb_id: number };
      audit(res, "film_source.upsert", `${row.platform}:${row.content_id}`);
      res.json({
        platform: row.platform,
        contentId: row.content_id,
        tmdbId: row.tmdb_id,
      });
    }),
  );
}
