/**
 * app/page.tsx
 *
 * Homepage — hero section, six feature cards, and a live global document
 * counter fetched from Supabase on each request.
 *
 * The counter fetch is intentionally server-side (async Server Component) so
 * the count is rendered on first paint without a client-side loading flash.
 * When Supabase is not configured the count is simply not displayed.
 */

import FeatureCard from "@/components/FeatureCard";
import { FEATURES } from "@/utils/constants";
import { fetchTotalProcessed } from "@/lib/supabase";

export default async function HomePage() {
  // Fetch the counter server-side. Returns null when Supabase is unconfigured.
  const totalProcessed = await fetchTotalProcessed();

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-14 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Free PDF Tools
        </h1>
        <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
          Edit, merge, split, compress, and convert PDFs — entirely in your browser.
          <br />
          Your files never leave your device.
        </p>

        {/* Global usage counter — only rendered when Supabase is configured */}
        {totalProcessed !== null && (
          <p className="mt-5 text-sm text-gray-500">
            <span className="font-semibold text-gray-800">
              {totalProcessed.toLocaleString()}
            </span>{" "}
            documents processed globally
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Feature cards grid                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="PDF Tools">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.href} feature={feature} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Privacy reassurance                                                  */}
      {/* ------------------------------------------------------------------ */}
      <section className="mt-16 rounded-lg border border-gray-200 bg-gray-50 px-6 py-8 text-center">
        <h2 className="text-base font-semibold text-gray-900 mb-2">
          100% Client-Side Processing
        </h2>
        <p className="text-sm text-gray-600 max-w-xl mx-auto">
          Every operation runs directly in your browser using Web APIs. No files are uploaded to
          any server. Your PDFs stay private, always.
        </p>
      </section>
    </main>
  );
}
