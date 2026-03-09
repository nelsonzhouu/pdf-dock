/**
 * lib/types.ts
 *
 * Shared TypeScript type definitions for the PDF parser and editor.
 *
 * Key design principle: every TextBlock carries a FontReference that includes
 * the PDF indirect object reference (e.g. "5 0 R"). When editing text we
 * reuse this same object reference in the content stream — no new font is
 * ever created or embedded, giving us ~90% font preservation for free.
 */

// ---------------------------------------------------------------------------
// Font types
// ---------------------------------------------------------------------------

/**
 * A fully resolved font entry extracted directly from the PDF's object graph.
 *
 * `objectRef` is the most important field: it is the indirect object reference
 * string (e.g. "5 0 R") that already exists inside the PDF. When we write
 * edited text back we reuse this exact reference so no font re-embedding occurs.
 */
export interface FontReference {
  /** PDF resource alias used inside content streams, e.g. "F1", "F2", "R9". */
  alias: string;

  /**
   * Indirect object reference string, e.g. "5 0 R".
   * Reusing this reference when editing avoids any font re-embedding.
   * Value is "inline" when the font dict is embedded directly without a ref.
   */
  objectRef: string;

  /** PostScript/BaseFont name, e.g. "Helvetica", "ArialMT", "ABCDEF+TimesNewRoman". */
  baseFontName: string;

  /** PDF font subtype: "Type1" | "TrueType" | "CIDFontType2" | "Type0" | "Type3" etc. */
  subtype: string;

  /**
   * Glyph advance widths in 1/1000 text-space units.
   * Index = (charCode - firstChar).
   * A value of 0 means the character is not in the Widths table.
   */
  widths: number[];

  /**
   * Lowest character code covered by the Widths array.
   * Typically 32 (space) for Latin fonts.
   */
  firstChar: number;

  /**
   * Highest character code covered by the Widths array.
   * Derived from firstChar + widths.length - 1.
   */
  lastChar: number;

  /**
   * Encoding name or null when the font uses a custom/embedded encoding.
   * Common values: "WinAnsiEncoding", "MacRomanEncoding", "StandardEncoding".
   */
  encoding: string | null;

  /**
   * Page index (0-based) this font was first seen on.
   * The same font may appear on multiple pages; we deduplicate by objectRef.
   */
  firstSeenOnPage: number;
}

/**
 * Map from PDF resource alias (e.g. "F1") to the resolved FontReference.
 * Aliases are page-scoped in PDF; this map is populated for all pages combined.
 * When the same font appears under different aliases on different pages,
 * both aliases are included and both point to the same underlying objectRef.
 */
export type FontMap = Map<string, FontReference>;

// ---------------------------------------------------------------------------
// Text block types
// ---------------------------------------------------------------------------

/**
 * A single text run extracted from the PDF, with position, content,
 * and a direct link to the FontReference needed to reuse the font on edit.
 */
export interface TextBlock {
  /** Unique identifier: "p{pageIndex}-b{blockIndex}". */
  id: string;

  /** 0-based page index this text was found on. */
  pageIndex: number;

  /** The decoded text string as it would appear to a reader. */
  content: string;

  /** X coordinate in PDF user-space (points, origin bottom-left). */
  x: number;

  /** Y coordinate in PDF user-space (points, origin bottom-left). */
  y: number;

  /** Approximate rendered width in PDF user-space points. */
  width: number;

  /** Approximate rendered height in PDF user-space points (≈ fontSize). */
  height: number;

  /** Rendered font size in points. */
  fontSize: number;

  /**
   * PDF resource alias for this block's font, e.g. "F1".
   * Used to look up the FontReference in the FontMap.
   * May be null if pdfjs could not determine the alias.
   */
  fontAlias: string | null;

  /**
   * The resolved FontReference for this block.
   * Null if the font alias could not be matched to an extracted font.
   * When null, font preservation is not possible and the editor shows a warning.
   */
  fontRef: FontReference | null;

  /**
   * Raw font name as returned by pdfjs-dist.
   * Kept for debugging; may differ from fontAlias in some PDFs.
   */
  pdfjsFontName: string;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Calculated text dimensions in PDF user-space points. */
export interface TextMetrics {
  /** Total advance width of the string using the font's character width table. */
  width: number;
  /** Approximate height (= fontSize for most Latin fonts). */
  height: number;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown by preserveFont() when the original text cannot be located in the
 * content stream, or when the font dict is missing required fields.
 *
 * The editor catches this error and shows the user a warning that the edit
 * will fall back to a text-overlay approach.
 */
export class FontPreservationError extends Error {
  constructor(
    message: string,
    /** Additional context for debugging (not shown to the user). */
    public readonly debugInfo?: Record<string, unknown>
  ) {
    super(message);
    this.name = "FontPreservationError";
  }
}
