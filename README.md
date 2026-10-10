# MovieKind API

HTTP API for a movie-night app. People save films they liked, pick a few for tonight, and get recommendations from other people with the same taste.

The Supabase tables already exist. This service does not create or change them. It sends the caller's Supabase JWT with the publishable key, so Postgres row level security applies.

## Setup

```bash
npm install
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase publishable key (the anon key) |
| `TMDB_API_KEY` | TMDB v4 read access token |
| `PORT` | Port to listen on. Defaults to 3000 |
| `ALLOWED_ORIGIN` | Optional comma-separated browser origins allowed to call the API. Unset means no CORS |
| `NODE_ENV` | Set to `production` on the host. Hides the local test page |

## Run

```bash
npm run dev
```

`npm start` runs the server once. `npm test` runs the offline tests. Those tests do not call the network.

Open `http://localhost:3000` for the local login and search page. That page is not served when `NODE_ENV=production`.

API docs are at `http://localhost:3000/movie-api-docs`. Authorize with a Supabase access token. The raw spec is `GET /openapi.yaml`.

Every route except `GET /health`, `GET /movie-api-docs`, and `GET /openapi.yaml` requires `Authorization: Bearer` with a Supabase access token.

## Examples

```bash
curl http://localhost:3000/health
```

```bash
curl "http://localhost:3000/films/search?q=dune" \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN"
```

## Deploy

Render can run this as a free web service from [render.yaml](render.yaml).

1. Push the repo to GitHub.
2. In Render, create a Blueprint or a Web Service from the repo.
3. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `TMDB_API_KEY` in the Render dashboard. Do not commit `.env`.
4. Render sets `PORT`. The health check is `GET /health`.

The free instance sleeps after about 15 minutes without traffic. The first request after that is slow. Rate limits and the TMDB cache live in this one process.

After deploy, frontend developers use `https://YOUR_SERVICE.onrender.com/movie-api-docs`.
