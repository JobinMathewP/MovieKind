import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assertDb, HttpError } from "./http.js";

export const uuidSchema = z.string().uuid();

export const tmdbIdSchema = z.number().int().positive().max(2_147_483_647);

export function parseUuid(value: string | string[] | undefined, label: string): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `Invalid ${label}`);
  return parsed.data;
}

export function parseTmdbIdParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = z.coerce.number().int().positive().max(2_147_483_647).safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Invalid film id");
  return parsed.data;
}

export function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export async function displayNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  assertDb(error);
  for (const row of data ?? []) {
    names.set(row.id as string, row.display_name as string);
  }
  return names;
}

export function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
