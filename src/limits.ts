import type { Request, RequestHandler, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

function tooMany(_req: Request, res: Response): void {
  res.status(429).json({ error: "Too many requests" });
}

function userKey(req: Request, res: Response): string {
  const userId = (res.locals.context as { userId?: string } | undefined)?.userId;
  if (userId) return userId;
  return ipKeyGenerator(req.ip ?? "0.0.0.0");
}

export const globalLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
  handler: tooMany,
});

export const searchLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: tooMany,
});

export const writeLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  keyGenerator: userKey,
  handler: tooMany,
});
