import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RequestHandler } from "express";
import { createTtlCache } from "./cache.js";
import type { AppConfig } from "./config.js";

export type RequestContext = {
  userId: string;
  supabase: SupabaseClient;
};

const userCache = createTtlCache<string>({ ttlMs: 60_000, max: 1_000 });

function tokenKey(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

export function createUserClient(config: AppConfig, accessToken: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

async function authenticate(
  config: AppConfig,
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
): Promise<boolean> {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const accessToken = match?.[1];
  if (!accessToken) {
    res.status(401).json({ error: "Missing bearer token" });
    return false;
  }
  if (accessToken.split(".").length !== 3) {
    res.status(401).json({ error: "Invalid token" });
    return false;
  }

  const cachedUserId = userCache.get(tokenKey(accessToken));
  if (cachedUserId) {
    res.locals.context = {
      userId: cachedUserId,
      supabase: createUserClient(config, accessToken),
    } satisfies RequestContext;
    return true;
  }

  const authClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) {
    res.status(401).json({ error: "Invalid token" });
    return false;
  }

  userCache.set(tokenKey(accessToken), data.user.id);

  const context: RequestContext = {
    userId: data.user.id,
    supabase: createUserClient(config, accessToken),
  };
  res.locals.context = context;
  return true;
}

export function requireUser(config: AppConfig): RequestHandler {
  return (req, res, next) => {
    authenticate(config, req, res)
      .then((ok) => {
        if (ok) next();
      })
      .catch(next);
  };
}

export function getContext(res: { locals: { context?: RequestContext } }): RequestContext {
  const context = res.locals.context;
  if (!context) throw new Error("Missing request context");
  return context;
}
