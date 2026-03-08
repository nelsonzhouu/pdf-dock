/**
 * app/donate/success/page.tsx
 *
 * Post-donation thank-you page — Phase 7 implementation.
 * Placeholder shown until Phase 7 is built.
 */

import Link from "next/link";

export default function DonateSuccessPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="text-4xl mb-4">🎉</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h1>
      <p className="text-gray-600 mb-6">Your support helps keep PDFDock free for everyone.</p>
      <Link href="/" className="text-sm text-gray-700 underline hover:text-gray-900">
        Back to home
      </Link>
    </main>
  );
}
