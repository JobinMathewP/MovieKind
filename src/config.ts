import fs from "node:fs";
import path from "node:path";

export type AppConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  tmdbApiKey: string;
  port: number;
  production: boolean;
  allowedOrigins: string[];
};

export function loadEnv(cwd = process.cwd()): void {
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(",").flatMap((item) => {
    const trimmed = item.trim();
    if (!trimmed) return [];
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("ALLOWED_ORIGIN entries must be absolute http(s) origins");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("ALLOWED_ORIGIN entries must use http or https");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
      throw new Error("ALLOWED_ORIGIN entries must be origins without a path");
    }
    return [parsed.origin];
  });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function readConfig(): AppConfig {
  const portRaw = process.env.PORT?.trim();
  let port = 3000;
  if (portRaw) {
    port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be an integer between 1 and 65535");
    }
  }

  return {
    supabaseUrl: required("SUPABASE_URL"),
    supabaseAnonKey: required("SUPABASE_ANON_KEY"),
    tmdbApiKey: required("TMDB_API_KEY"),
    port,
    production: process.env.NODE_ENV === "production",
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGIN),
  };
}
