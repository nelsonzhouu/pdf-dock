/**
 * app/api/track-usage/route.ts
 *
 * POST /api/track-usage
 *
 * Increments the global document-processed counter in Supabase by 1.
 * Called client-side after every successful file download.
 *
 * Security notes:
 * - No authentication is required (this is a public counter).
 * - The Supabase anon key only has permission to call the increment RPC;
 *   it cannot read/write arbitrary rows. Configure this in Supabase RLS.
 * - Basic request validation is performed before touching the database.
 * - In production, consider adding rate limiting via Vercel middleware to
 *   prevent artificial inflation of the counter.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Build the Supabase client inside the route handler so the module can be
// imported without crashing when env vars are absent (e.g. during static analysis).
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  return createClient(url, key);
}

export async function POST(request: Request) {
  // Validate Content-Type to reject obviously malformed requests.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }

  const supabase = getSupabaseClient();

  // When Supabase is not configured, return success silently so the
  // client-side flow isn't interrupted during local development.
  if (!supabase) {
    return NextResponse.json({ success: true, configured: false });
  }

  try {
    // Fetch the current counter row (there is exactly one row in usage_stats).
    const { data, error: fetchError } = await supabase
      .from("usage_stats")
      .select("id, total_documents_processed")
      .limit(1)
      .single();

    if (fetchError || !data) {
      console.error("[track-usage] fetch error:", fetchError?.message);
      return NextResponse.json(
        { error: "Failed to read usage stats" },
        { status: 500 }
      );
    }

    // Increment and write back.
    const { error: updateError } = await supabase
      .from("usage_stats")
      .update({
        total_documents_processed: data.total_documents_processed + 1,
        last_updated: new Date().toISOString(),
      })
      .eq("id", data.id);

    if (updateError) {
      console.error("[track-usage] update error:", updateError.message);
      return NextResponse.json(
        { error: "Failed to update usage stats" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[track-usage] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Reject non-POST methods explicitly.
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
