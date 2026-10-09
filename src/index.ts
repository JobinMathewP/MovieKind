import { createApp } from "./app.js";
import { loadEnv, readConfig } from "./config.js";
import { logger } from "./log.js";

loadEnv();
const config = readConfig();
const app = createApp(config);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "MovieKind API listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
