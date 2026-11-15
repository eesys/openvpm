/** A pooled URL cannot use the prepared statements postgres-js enables by default. */
export function isPooledDatabaseConnection(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const supabasePooler =
      hostname === "pooler.supabase.com" ||
      hostname.endsWith(".pooler.supabase.com");
    return (
      supabasePooler ||
      url.port === "6543" ||
      url.searchParams.get("pgbouncer")?.toLowerCase() === "true"
    );
  } catch {
    return false;
  }
}
