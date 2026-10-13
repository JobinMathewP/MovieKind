import assert from "node:assert/strict";
import test from "node:test";
import { pickPopularFilms, type DeckFilm, type LovedRow } from "../src/popular.js";

function film(tmdbId: number, title: string, posterPath: string | null = `/${tmdbId}.jpg`): DeckFilm {
  return {
    tmdbId,
    title,
    originalTitle: title,
    year: 2020,
    posterPath,
    originalLanguage: "ml",
    genreNames: ["Drama"],
  };
}

function loved(tmdbId: number, rating: number, posterPath: string | null = `/${tmdbId}.jpg`): LovedRow {
  return { tmdbId, rating, film: film(tmdbId, `Film ${tmdbId}`, posterPath) };
}

test("loved films come first, discovery only fills the gap, and excluded ids never return", () => {
  const picked = pickPopularFilms(
    [loved(1, 5), loved(1, 4), loved(2, 5), loved(3, 4), loved(9, 5, null)],
    [film(2, "Already loved"), film(4, "Discovered"), film(5, "No poster", null), film(6, "Next")],
    new Set([3]),
    3,
  );

  assert.deepEqual(
    picked.map((entry) => entry.tmdbId),
    [1, 2, 4],
  );
});
