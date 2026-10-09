import assert from "node:assert/strict";
import test from "node:test";
import { mapTmdbMovieDetails } from "../src/tmdb.js";

test("maps a TMDB movie details payload", () => {
  const film = mapTmdbMovieDetails({
    id: 157336,
    title: "Interstellar",
    original_title: "Interstellar",
    release_date: "2014-11-05",
    poster_path: "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    original_language: "en",
    genres: [
      { id: 12, name: "Adventure" },
      { id: 18, name: "Drama" },
      { id: 878, name: "Science Fiction" },
    ],
    runtime: 169,
    overview: "A team of explorers travel through a wormhole in space.",
  });

  assert.equal(film.year, 2014);
  assert.equal(film.posterPath, "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg");
  assert.deepEqual(film.genres, ["Adventure", "Drama", "Science Fiction"]);
  assert.equal(film.runtimeMinutes, 169);
  assert.equal(film.overview, "A team of explorers travel through a wormhole in space.");
});
