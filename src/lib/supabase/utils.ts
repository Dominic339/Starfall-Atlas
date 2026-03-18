/**
 * Utility helpers for working with the untyped admin client.
 *
 * When the admin Supabase client is used without a Database generic, TypeScript
 * may infer query result `data` as `null` or `never`, which breaks type narrowing.
 * These helpers apply explicit type assertions so action code stays readable.
 *
 * Once `supabase gen types typescript` is run and a Database type is wired up,
 * these casts can be removed in favour of generated column types.
 */

/**
 * Cast the result of a `.single()` query to a known row type.
 * Use immediately after awaiting the query.
 *
 * @example
 * const { data: ship, error } = singleResult<ShipRow>(
 *   await admin.from("ships").select("id, owner_id").eq("id", id).single()
 * );
 */
export function singleResult<T>(raw: {
  data: unknown;
  error: unknown;
}): { data: T | null; error: unknown } {
  return raw as { data: T | null; error: unknown };
}

/**
 * Cast the result of a `.maybeSingle()` query to a known row type.
 */
export function maybeSingleResult<T>(raw: {
  data: unknown;
  error: unknown;
}): { data: T | null; error: unknown } {
  return raw as { data: T | null; error: unknown };
}

/**
 * Cast the result of a list query (`.select()` without `.single()`) to a typed array.
 */
export function listResult<T>(raw: {
  data: unknown;
  error: unknown;
  count?: number | null;
}): { data: T[] | null; error: unknown; count?: number | null } {
  return raw as { data: T[] | null; error: unknown; count?: number | null };
}
