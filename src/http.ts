import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PostgrestError } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { logger } from "./log.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function assertDb(error: PostgrestError | null): void {
  if (!error) return;
  if (error.code === "23505") throw new HttpError(409, "Already exists");
  if (error.code === "23503") throw new HttpError(400, "Related record not found");
  if (error.code === "23514") throw new HttpError(400, "That value is not allowed");
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    throw new HttpError(403, "Not allowed");
  }
  logger.error({ err: error }, "database request failed");
  throw new HttpError(500, "Database request failed");
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (
    error instanceof SyntaxError ||
    (typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.parse.failed")
  ) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  logger.error({ err: error }, "request failed");
  res.status(500).json({ error: "Internal server error" });
}
