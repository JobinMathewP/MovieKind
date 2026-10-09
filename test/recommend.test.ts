import assert from "node:assert/strict";
import test from "node:test";
import { rankRecommendations, type RankFilm, type RankReview } from "../src/recommend.js";

const caller = "caller";
const alice = "alice";
const bob = "bob";
const carol = "carol";
const dave = "dave";
const eve = "eve";
const frank = "frank";

const SEED_A = 101;
const SEED_B = 102;
const SEED_C = 103;
const POPULAR = 201;
const HIGH_AVG = 202;
const SEEN = 203;
const THREE_STAR = 204;
const STRANGER_ONLY = 205;
const DAVE_PICK = 206;
const ENGLISH_TIE = 207;
const MALAYALAM_TIE = 208;

function film(tmdbId: number, title: string, originalLanguage: string): RankFilm {
  return {
    tmdbId,
    title,
    year: 2018,
    posterPath: `/${tmdbId}.jpg`,
    genres: ["Science Fiction"],
    originalLanguage,
  };
}

function review(userId: string, displayName: string, tmdbId: number, rating: number | null): RankReview {
  return { userId, displayName, tmdbId, rating };
}

const films: RankFilm[] = [
  film(SEED_A, "Arrival", "en"),
  film(SEED_B, "Ex Machina", "en"),
  film(SEED_C, "Coherence", "en"),
  film(POPULAR, "Annihilation", "en"),
  film(HIGH_AVG, "Blade Runner 2049", "en"),
  film(SEEN, "Dune", "en"),
  film(THREE_STAR, "The Room", "en"),
  film(STRANGER_ONLY, "Parasite", "ko"),
  film(DAVE_PICK, "Spirited Away", "ja"),
  film(ENGLISH_TIE, "Inception", "en"),
  film(MALAYALAM_TIE, "Nayakan", "ml"),
];

const reviews: RankReview[] = [
  review(caller, "Caller", SEED_A, 5),
  review(caller, "Caller", SEED_B, 5),
  review(caller, "Caller", SEED_C, 4),
  review(caller, "Caller", SEEN, null),

  review(alice, "Alice", SEED_A, 5),
  review(alice, "Alice", SEED_B, 4),
  review(alice, "Alice", POPULAR, 5),
  review(alice, "Alice", HIGH_AVG, 5),
  review(alice, "Alice", SEEN, 5),
  review(alice, "Alice", THREE_STAR, 3),
  review(alice, "Alice", MALAYALAM_TIE, 5),
  review(alice, "Alice", ENGLISH_TIE, 4),

  review(bob, "Bob", SEED_B, 5),
  review(bob, "Bob", SEED_C, 5),
  review(bob, "Bob", POPULAR, 4),
  review(bob, "Bob", HIGH_AVG, 5),
  review(bob, "Bob", MALAYALAM_TIE, 4),
  review(bob, "Bob", ENGLISH_TIE, 5),

  review(carol, "Carol", SEED_A, 5),
  review(carol, "Carol", SEED_C, 4),
  review(carol, "Carol", POPULAR, 5),
  review(carol, "Carol", STRANGER_ONLY, 5),

  review(dave, "Dave", SEED_A, 3),
  review(dave, "Dave", DAVE_PICK, 5),

  review(eve, "Eve", SEED_A, 4),
  review(eve, "Eve", POPULAR, 4),

  review(frank, "Frank", SEED_B, 4),
  review(frank, "Frank", POPULAR, 4),
];

const followingIds = [alice, bob, eve, frank, dave];

test("ranks likes, hides seen films, ignores 3-star ratings, and followersOnly drops strangers", () => {
  const open = rankRecommendations({
    callerId: caller,
    seedTmdbIds: [SEED_A, SEED_B, SEED_C],
    reviews,
    films,
    languages: ["ml"],
    followingIds,
    followersOnly: false,
  });

  assert.deepEqual(
    open.map((entry) => entry.tmdbId),
    [POPULAR, HIGH_AVG, MALAYALAM_TIE, ENGLISH_TIE, STRANGER_ONLY],
  );

  const popular = open[0];
  if (!popular) throw new Error("expected a recommendation");
  assert.equal(popular.title, "Annihilation");
  assert.equal(popular.year, 2018);
  assert.equal(popular.posterPath, `/${POPULAR}.jpg`);
  assert.deepEqual(popular.genres, ["Science Fiction"]);
  assert.equal(popular.originalLanguage, "en");
  assert.equal(popular.likedByCount, 5);
  assert.equal(popular.matchCount, 5);
  assert.equal(popular.averageRating, 4.4);
  assert.deepEqual(popular.matchNames, ["Alice", "Carol", "Bob", "Eve"]);

  const highAverage = open[1];
  if (!highAverage) throw new Error("expected the high-average film");
  assert.equal(highAverage.tmdbId, HIGH_AVG);
  assert.equal(highAverage.likedByCount, 2);
  assert.equal(highAverage.averageRating, 5);

  const ids = new Set(open.map((entry) => entry.tmdbId));
  assert.equal(ids.has(SEEN), false);
  assert.equal(ids.has(THREE_STAR), false);
  assert.equal(ids.has(DAVE_PICK), false);
  assert.equal(ids.has(SEED_A), false);
  assert.equal(ids.has(SEED_B), false);
  assert.equal(ids.has(SEED_C), false);

  const noLanguagePreference = rankRecommendations({
    callerId: caller,
    seedTmdbIds: [SEED_A, SEED_B, SEED_C],
    reviews,
    films,
    languages: [],
    followingIds,
    followersOnly: false,
  });
  assert.deepEqual(
    noLanguagePreference.map((entry) => entry.tmdbId),
    [POPULAR, HIGH_AVG, ENGLISH_TIE, MALAYALAM_TIE, STRANGER_ONLY],
  );

  const followed = rankRecommendations({
    callerId: caller,
    seedTmdbIds: [SEED_A, SEED_B, SEED_C],
    reviews,
    films,
    languages: ["ml"],
    followingIds,
    followersOnly: true,
  });
  assert.deepEqual(
    followed.map((entry) => entry.tmdbId),
    [POPULAR, HIGH_AVG, MALAYALAM_TIE, ENGLISH_TIE],
  );

  const followedPopular = followed[0];
  if (!followedPopular) throw new Error("expected a followed recommendation");
  assert.equal(followedPopular.likedByCount, 4);
  assert.equal(followedPopular.matchCount, 4);
  assert.equal(followedPopular.averageRating, 4.25);
  assert.deepEqual(followedPopular.matchNames, ["Alice", "Bob", "Eve", "Frank"]);
  assert.equal(
    followed.some((entry) => entry.tmdbId === STRANGER_ONLY),
    false,
  );
  assert.equal(
    followed.some((entry) => entry.tmdbId === DAVE_PICK),
    false,
  );
});
