import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import type { AppConfig } from './config.js';
import { requireUser } from './auth.js';
import { errorHandler } from './http.js';
import { globalLimiter, searchLimiter, writeLimiter } from './limits.js';
import { httpLogger } from './log.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerFilmSourceRoutes } from './routes/filmSources.js';
import { registerPlaylistRoutes } from './routes/playlists.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerRecommendationRoutes } from './routes/recommendations.js';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function createApp(config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const docs = req.path === '/docs' || req.path.startsWith('/docs/');
    helmet({ contentSecurityPolicy: docs ? false : undefined })(req, res, next);
  });
  app.use(httpLogger);
  if (config.allowedOrigin) {
    app.use(cors({ origin: config.allowedOrigin }));
  }
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(globalLimiter);

  const openApiPath = path.join(rootDir, 'openapi.yaml');
  const openApi = parse(readFileSync(openApiPath, 'utf8')) as Record<
    string,
    unknown
  >;
  app.get('/openapi.yaml', (_req, res) => {
    res.type('yaml').sendFile(openApiPath);
  });
  app.use('/movie-api-docs', swaggerUi.serve, swaggerUi.setup(openApi));

  if (!config.production) {
    app.get('/dev/config', (_req, res) => {
      res.json({
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
      });
    });
    app.use(express.static(path.join(rootDir, 'public')));
  }

  app.use(requireUser(config));
  app.use('/films/search', searchLimiter);
  app.use(writeLimiter);
  registerProfileRoutes(app);
  registerCatalogRoutes(app, config);
  registerRecommendationRoutes(app);
  registerPlaylistRoutes(app);
  registerFilmSourceRoutes(app);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);
  return app;
}
