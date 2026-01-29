/**
 * Conversion helpers for SQLite ↔ JS types.
 *
 * D1/SQLite stores:
 *   - booleans as INTEGER 0 | 1
 *   - timestamps as INTEGER (unix milliseconds)
 */

/** Date → unix-ms integer for D1 storage. Returns null for nullish input. */
export function toTimestamp(date: Date | null | undefined): number | null {
  if (!date) return null;
  return date.getTime();
}

/** Unix-ms integer → Date. Returns null for nullish input. */
export function fromTimestamp(ts: number | null | undefined): Date | null {
  if (ts == null) return null;
  return new Date(ts);
}

/** JS boolean → SQLite integer (0 | 1). */
export function toBool(value: boolean): number {
  return value ? 1 : 0;
}

/** SQLite integer → JS boolean. Treats null/0 as false. */
export function fromBool(value: number | null | undefined): boolean {
  return value === 1;
}
