/**
 * components/Footer.tsx
 *
 * Minimal site footer with links to the About and Donate pages, plus a
 * brief privacy reminder (all processing is client-side).
 */

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white mt-auto">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-4 text-sm text-gray-500">
        <p>© {new Date().getFullYear()} PDFDock — all processing happens in your browser.</p>

        <nav className="flex gap-x-4">
          <Link href="/about" className="hover:text-gray-900 hover:underline">
            About &amp; Privacy
          </Link>
          <Link href="/donate" className="hover:text-gray-900 hover:underline">
            Donate
          </Link>
        </nav>
      </div>
    </footer>
  );
}
