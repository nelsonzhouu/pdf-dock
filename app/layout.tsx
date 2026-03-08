/**
 * app/layout.tsx
 *
 * Root layout — wraps every page with the site Header and Footer.
 * Sets global metadata (title, description, viewport) for SEO and sharing.
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PDFDock — Free Browser-Based PDF Tools",
    template: "%s | PDFDock",
  },
  description:
    "Edit, merge, split, compress, and convert PDFs entirely in your browser. Files never leave your device.",
  keywords: ["PDF editor", "merge PDF", "split PDF", "compress PDF", "PDF to image", "image to PDF"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col bg-gray-50`}
      >
        <Header />
        {/* flex-1 ensures the footer stays at the bottom on short pages */}
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
