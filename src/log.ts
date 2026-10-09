import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";
import pinoHttp from "pino-http";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers.cookie"],
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (_req: IncomingMessage, res: ServerResponse) => {
    const id = randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customProps: (_req, res) => {
    const userId = (res as ServerResponse & { locals?: { context?: { userId?: string } } }).locals?.context
      ?.userId;
    return userId ? { userId } : {};
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
      };
    },
  },
});

export function audit(res: { locals: { context?: { userId?: string } } }, action: string, target: string): void {
  logger.info(
    {
      audit: true,
      action,
      userId: res.locals.context?.userId,
      target,
    },
    "audit",
  );
}
