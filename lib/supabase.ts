/**
 * lib/supabase.ts
 *
 * Supabase client singleton used for reading/writing the global usage counter.
 *
 * Both environment variables are optional during local development.
 * When they are absent the exported `supabase` value is `null` and every
 * helper in this file returns a safe fallback so the UI still renders.
 *
 * Security note: only the public anon key is used here. The anon key grants
 * read access to the usage_stats table (no RLS bypass). The track-usage API
 * route uses the same anon key server-side because the counter update is
 * performed via a Postgres function (rpc) that is rate-limited at the DB level.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Client creation — gracefully handles missing env vars
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * The Supabase client, or `null` when credentials are not configured.
 * Always null-check this before use.
 */
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export default supabase;

// ---------------------------------------------------------------------------
// Helper: fetch the global document counter
// ---------------------------------------------------------------------------

/**
 * Fetches the total number of documents processed globally from Supabase.
 *
 * Returns `null` when:
 * - Supabase credentials are not configured
 * - The network request fails
 * - The table/row doesn't exist yet
 *
 * The caller is responsible for rendering a fallback (e.g. hide the counter
 * or display 0).
 */
export async function fetchTotalProcessed(): Promise<number | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("usage_stats")
      .select("total_documents_processed")
      .limit(1)
      .single();

    if (error || !data) return null;

    return data.total_documents_processed as number;
  } catch {
    return null;
  }
}
