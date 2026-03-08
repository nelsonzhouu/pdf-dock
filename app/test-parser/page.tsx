/**
 * app/test-parser/page.tsx
 *
 * Developer utility page for validating the PDF stream parser (Phase 2A).
 * Upload a PDF to inspect extracted font dictionaries and text blocks.
 * This page is for development/debugging only — remove or protect in production.
 */

export default function TestParserPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="text-4xl mb-4">🔬</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">PDF Parser Test</h1>
      <p className="text-gray-600">
        This dev page will be built in Phase 2A to test font extraction and text block parsing.
      </p>
    </main>
  );
}
