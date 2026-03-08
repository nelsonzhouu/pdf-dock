/**
 * components/Header.tsx
 *
 * Site-wide navigation header. Displays the PDFDock logo/wordmark on the left
 * and links to all six tools plus Donate and About on the right.
 * Collapses gracefully on smaller screens via a simple wrapping flex layout.
 */

import Link from "next/link";

const toolLinks = [
  { label: "Edit PDF", href: "/edit-pdf" },
  { label: "Merge", href: "/merge-pdf" },
  { label: "Split", href: "/split-pdf" },
  { label: "Compress", href: "/compress-pdf" },
  { label: "PDF→Image", href: "/pdf-to-image" },
  { label: "Image→PDF", href: "/image-to-pdf" },
];

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        {/* Logo / wordmark */}
        <Link
          href="/"
          className="text-xl font-bold tracking-tight text-gray-900 hover:text-gray-700"
        >
          PDFDock
        </Link>

        {/* Tool navigation */}
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
          {toolLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-gray-900 hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Secondary links pushed to the right */}
        <div className="ml-auto flex items-center gap-x-4 text-sm">
          <Link
            href="/donate"
            className="rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50"
          >
            Donate
          </Link>
          <Link href="/about" className="text-gray-600 hover:text-gray-900 hover:underline">
            About
          </Link>
        </div>
      </div>
    </header>
  );
}
