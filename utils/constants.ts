/**
 * utils/constants.ts
 *
 * Application-wide constants: file size limits, page limits, accepted MIME types,
 * and feature metadata used across the app.
 */

// ---------------------------------------------------------------------------
// File size & page limits (enforced client-side before any processing begins)
// ---------------------------------------------------------------------------

/** Maximum allowed file size for any single PDF upload, in bytes (50 MB). */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Human-readable version of MAX_FILE_SIZE_BYTES for display in error messages. */
export const MAX_FILE_SIZE_LABEL = "50 MB";

/** Maximum number of pages allowed in a PDF before processing is refused. */
export const MAX_PDF_PAGES = 500;

/** Maximum number of images allowed in a single Image → PDF conversion. */
export const MAX_IMAGE_FILES = 100;

// ---------------------------------------------------------------------------
// Accepted MIME types
// ---------------------------------------------------------------------------

/** MIME type for PDF files. */
export const MIME_PDF = "application/pdf";

/** Accepted image MIME types for Image → PDF conversion. */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// ---------------------------------------------------------------------------
// Donation amounts (in USD cents for Stripe)
// ---------------------------------------------------------------------------

/** Preset donation amounts shown on the /donate page, in US dollars. */
export const DONATION_PRESETS_USD = [3, 5, 10];

/** Minimum allowed custom donation amount, in US dollars. */
export const MIN_DONATION_USD = 1;

// ---------------------------------------------------------------------------
// Donation popup localStorage key & cooldown
// ---------------------------------------------------------------------------

/** localStorage key that stores when the donation popup was last dismissed. */
export const DONATION_POPUP_DISMISSED_KEY = "pdfdock_donation_dismissed_at";

/** How long (in milliseconds) to suppress the donation popup after dismissal (24 hours). */
export const DONATION_POPUP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Feature list — used on the homepage to render feature cards
// ---------------------------------------------------------------------------

export interface Feature {
  title: string;
  description: string;
  href: string;
  icon: string; // emoji icon for the card
}

export const FEATURES: Feature[] = [
  {
    title: "Edit PDF",
    description: "Click any text to edit it inline. Original fonts are preserved directly from the PDF stream.",
    href: "/edit-pdf",
    icon: "✏️",
  },
  {
    title: "Merge PDFs",
    description: "Combine multiple PDF files into one. Drag to reorder before merging.",
    href: "/merge-pdf",
    icon: "🔗",
  },
  {
    title: "Split PDF",
    description: "Extract specific pages or page ranges. Download results as a ZIP.",
    href: "/split-pdf",
    icon: "✂️",
  },
  {
    title: "Compress PDF",
    description: "Reduce file size with metadata removal and object stream compression.",
    href: "/compress-pdf",
    icon: "📦",
  },
  {
    title: "PDF → Image",
    description: "Export every page as a PNG or JPG at your chosen DPI.",
    href: "/pdf-to-image",
    icon: "🖼️",
  },
  {
    title: "Image → PDF",
    description: "Convert PNG, JPG, WEBP, or GIF files into a single PDF document.",
    href: "/image-to-pdf",
    icon: "📄",
  },
];
