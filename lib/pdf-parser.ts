/**
 * lib/pdf-parser.ts
 *
 * Core PDF stream parser — implements the lightweight font-preservation strategy:
 *
 *   1. Load the PDF with pdf-lib and walk its internal object graph directly.
 *   2. Find every /Font entry in every page's resource dictionary.
 *   3. Capture the indirect object reference ("5 0 R") for each font — this is
 *      the key that lets us REUSE the existing font without re-embedding it.
 *   4. Use pdfjs-dist's getTextContent() for accurate text positions (it already
 *      handles every PDF text operator and encoding variant).
 *   5. When editing: locate the text in the raw content stream and replace the
 *      string operand while keeping the same /Tf font reference unchanged.
 *
 * No WASM, no font re-embedding — just direct PDF object-graph navigation and
 * content-stream text substitution.
 *
 * Dependencies:
 *   - pdf-lib  — PDF loading, object-graph access, saving
 *   - pdfjs-dist — text content extraction with positions
 *   - pako     — FlateDecode stream decompression / recompression
 *
 * IMPORTANT: all exported functions are async and browser-safe.
 * They must only be called from client components (not during SSR).
 */

import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFArray,
  PDFNumber,
  PDFRef,
  PDFRawStream,
  PDFString,
  PDFHexString,
} from "pdf-lib";
import { inflate, deflate } from "pako";
import type { FontMap, FontReference, TextBlock, TextMetrics } from "./types";
import { FontPreservationError } from "./types";

// ---------------------------------------------------------------------------
// pdfjs-dist — lazy-loaded to avoid SSR issues in Next.js.
// The worker is configured on first use inside initPdfJs().
// ---------------------------------------------------------------------------

// We type this loosely so the module can be imported at the top level without
// triggering SSR-related errors — the actual load happens in initPdfJs().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any = null;

/**
 * Initialises pdfjs-dist and its web worker exactly once per browser session.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * Worker strategy: we point GlobalWorkerOptions.workerSrc at the minified
 * worker bundle shipped with pdfjs-dist. Next.js exposes node_modules files
 * via import.meta.url resolution during the Turbopack/webpack build.
 */
async function initPdfJs(): Promise<void> {
  if (pdfjsLib) return; // already initialised

  // Dynamic import keeps pdfjs out of the server bundle entirely.
  pdfjsLib = await import("pdfjs-dist");

  // Configure the worker. We reference the installed package's worker file
  // so the version always matches exactly.
  // import.meta.url makes webpack / Turbopack copy the file to _next/static
  // and returns the correct public URL at runtime.
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    console.log("[pdf-parser] pdfjs worker configured via import.meta.url");
  } catch {
    // Fallback: point directly at the unpkg CDN with the exact installed version
    const version: string = pdfjsLib.version as string;
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
    console.log(`[pdf-parser] pdfjs worker configured via CDN (v${version})`);
  }
}

// ===========================================================================
// SECTION 1 — Internal stream helpers
// ===========================================================================

/**
 * Decodes a PDF stream's raw bytes, handling the most common filter: FlateDecode.
 *
 * Most content streams in modern PDFs are compressed with zlib (FlateDecode).
 * We use pako.inflate() to decompress them. Unfiltered streams are returned
 * as-is. Other filters (LZWDecode, ASCII85, etc.) are returned unmodified with
 * a console warning — they are rare in practice.
 */
function decodeStream(stream: PDFRawStream): Uint8Array {
  const filterObj = stream.dict.lookup(PDFName.of("Filter"));

  if (!filterObj) {
    // No filter — raw bytes are the content
    return stream.contents;
  }

  // Filter can be a single PDFName or a PDFArray of names (filter pipeline)
  const filters: string[] = [];
  if (filterObj instanceof PDFName) {
    filters.push(filterObj.asString());
  } else if (filterObj instanceof PDFArray) {
    for (const f of filterObj.asArray()) {
      if (f instanceof PDFName) filters.push(f.asString());
    }
  }

  // We only handle a single FlateDecode filter (the overwhelmingly common case)
  if (filters.length === 1 && filters[0] === "FlateDecode") {
    try {
      return inflate(stream.contents);
    } catch (err) {
      console.error("[pdf-parser] FlateDecode decompression failed:", err);
      // Return raw bytes so the caller can still attempt parsing
      return stream.contents;
    }
  }

  // Multi-filter or unsupported filter
  console.warn(
    `[pdf-parser] Unsupported stream filter(s): ${filters.join(", ")} — returning raw bytes`
  );
  return stream.contents;
}

/**
 * Re-encodes modified content stream bytes back into a FlateDecode-compressed
 * PDFRawStream that pdf-lib can write to disk.
 *
 * We compress with pako.deflate() at level 6 (good balance of speed / ratio)
 * and update the stream dictionary to declare the FlateDecode filter and the
 * new byte Length.
 */
function encodeStream(
  rawBytes: Uint8Array,
  originalStream: PDFRawStream
): PDFRawStream {
  const compressed = deflate(rawBytes, { level: 6 });

  // Build a new dict copying keys from the original, then update Length/Filter
  const newDict = originalStream.dict.clone(originalStream.dict.context);
  newDict.set(PDFName.of("Length"), PDFNumber.of(compressed.length));
  newDict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));

  // Remove DecodeParms if present — our output uses default zlib params
  newDict.delete(PDFName.of("DecodeParms"));

  return PDFRawStream.of(newDict, compressed);
}

/**
 * Concatenates multiple Uint8Array buffers into one.
 * Used when a page has multiple content streams (PDF spec allows this).
 */
function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/**
 * Resolves a page's /Contents entry to its decoded byte content.
 *
 * /Contents may be:
 *   - A single PDFRef pointing to one stream
 *   - A PDFArray of PDFRefs each pointing to a stream
 * Both cases are handled; multiple streams are concatenated (spec §7.8.6).
 *
 * Returns null if the page has no content stream.
 */
function getPageContentBytes(
  page: ReturnType<PDFDocument["getPages"]>[number],
  context: PDFDocument["context"]
): Uint8Array | null {
  // Access the raw /Contents value from the page node dict
  const contentsVal = page.node.get(PDFName.of("Contents"));
  if (!contentsVal) return null;

  const streamBytes: Uint8Array[] = [];

  const resolveStream = (ref: PDFRef): void => {
    const obj = context.lookup(ref);
    if (obj instanceof PDFRawStream) {
      streamBytes.push(decodeStream(obj));
    }
  };

  if (contentsVal instanceof PDFRef) {
    resolveStream(contentsVal);
  } else if (contentsVal instanceof PDFArray) {
    for (const item of contentsVal.asArray()) {
      if (item instanceof PDFRef) resolveStream(item);
    }
  }

  return streamBytes.length > 0 ? concatBytes(streamBytes) : null;
}

// ===========================================================================
// SECTION 2 — Font extraction helpers
// ===========================================================================

/**
 * Safely resolves a PDFRef or returns the object itself if it is not a ref.
 * Returns null when the object doesn't match the expected type.
 */
function resolveDict(
  obj: unknown,
  context: PDFDocument["context"]
): PDFDict | null {
  if (obj instanceof PDFRef) {
    const resolved = context.lookup(obj);
    return resolved instanceof PDFDict ? resolved : null;
  }
  return obj instanceof PDFDict ? obj : null;
}

/**
 * Extracts the string value of a PDFName, PDFString, or PDFHexString.
 * Returns null for anything else.
 */
function nameOrStringValue(obj: unknown): string | null {
  if (obj instanceof PDFName) return obj.asString();
  if (obj instanceof PDFString) return obj.asString();
  if (obj instanceof PDFHexString) return obj.asString();
  return null;
}

/**
 * Extracts the numeric value from a PDFNumber (or indirect ref to one).
 * Returns null when the object is not a number.
 */
function numericValue(
  obj: unknown,
  context: PDFDocument["context"]
): number | null {
  const resolved = obj instanceof PDFRef ? context.lookup(obj) : obj;
  return resolved instanceof PDFNumber ? resolved.asNumber() : null;
}

/**
 * Builds a FontReference from a font dictionary and its location metadata.
 *
 * @param alias       - PDF resource alias, e.g. "F1"
 * @param fontDict    - The resolved /Font dictionary object
 * @param objectRef   - Indirect object reference string, e.g. "5 0 R" (or "inline")
 * @param pageIndex   - Page this font was first discovered on
 * @param context     - PDF context for resolving indirect refs inside the dict
 */
function buildFontReference(
  alias: string,
  fontDict: PDFDict,
  objectRef: string,
  pageIndex: number,
  context: PDFDocument["context"]
): FontReference {
  // --- BaseFont ---
  const baseFontRaw = fontDict.lookup(PDFName.of("BaseFont"));
  const baseFontName = nameOrStringValue(baseFontRaw) ?? "Unknown";

  // --- Subtype ---
  const subtypeRaw = fontDict.lookup(PDFName.of("Subtype"));
  const subtype = nameOrStringValue(subtypeRaw) ?? "Unknown";

  // --- FirstChar ---
  const firstCharRaw = fontDict.lookup(PDFName.of("FirstChar"));
  const firstChar = numericValue(firstCharRaw, context) ?? 0;

  // --- Widths ---
  // Widths may be an inline PDFArray or an indirect reference to one.
  const widthsRaw = fontDict.lookup(PDFName.of("Widths"));
  const widthsResolved =
    widthsRaw instanceof PDFRef ? context.lookup(widthsRaw) : widthsRaw;

  const widths: number[] = [];
  if (widthsResolved instanceof PDFArray) {
    for (const w of widthsResolved.asArray()) {
      const val = numericValue(w, context);
      widths.push(val ?? 0);
    }
  }

  const lastChar = firstChar + widths.length - 1;

  // --- Encoding ---
  const encodingRaw = fontDict.lookup(PDFName.of("Encoding"));
  let encoding: string | null = null;
  if (encodingRaw instanceof PDFName) {
    encoding = encodingRaw.asString();
  } else if (encodingRaw instanceof PDFRef) {
    // Encoding is an encoding dictionary — just note it is custom
    encoding = "CustomEncoding";
  } else if (encodingRaw instanceof PDFDict) {
    encoding = "CustomEncoding";
  }

  return {
    alias,
    objectRef,
    baseFontName,
    subtype,
    widths,
    firstChar,
    lastChar,
    encoding,
    firstSeenOnPage: pageIndex,
  };
}

// ===========================================================================
// SECTION 3 — Public API
// ===========================================================================

// ---------------------------------------------------------------------------
// extractFonts()
// ---------------------------------------------------------------------------

/**
 * Parses the raw PDF binary and extracts every font dictionary found in any
 * page's resource hierarchy.
 *
 * Approach:
 *   catalog → pages → page.Resources → /Font dict → each font entry
 *
 * For each font we capture its indirect object reference (e.g. "5 0 R") so
 * that when we write edited text back we can reuse the SAME font object
 * without creating or embedding a new one.
 *
 * @param bytes - Raw PDF file as a Uint8Array (e.g. from FileReader.readAsArrayBuffer)
 * @returns     - FontMap keyed by resource alias; deduplicates fonts that appear
 *               on multiple pages (same objectRef → one entry, first alias wins)
 */
export async function extractFonts(bytes: Uint8Array): Promise<FontMap> {
  console.log("[extractFonts] Loading PDF with pdf-lib...");

  const pdfDoc = await PDFDocument.load(bytes, {
    // Don't throw on minor spec violations — many real-world PDFs have them
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    updateMetadata: false,
  });

  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();
  const fontMap: FontMap = new Map();

  // Track seen objectRefs to avoid duplicating fonts across pages
  const seenObjectRefs = new Set<string>();

  console.log(`[extractFonts] PDF has ${pages.length} page(s)`);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];

    // ---- Navigate: page node → Resources → Font dict ----
    const resourcesVal = page.node.get(PDFName.of("Resources"));
    const resourcesDict = resolveDict(resourcesVal, context);

    if (!resourcesDict) {
      console.log(`[extractFonts] Page ${pageIndex}: no Resources dict, skipping`);
      continue;
    }

    const fontDictVal = resourcesDict.lookup(PDFName.of("Font"));
    const fontDict = resolveDict(fontDictVal, context);

    if (!fontDict) {
      console.log(`[extractFonts] Page ${pageIndex}: no /Font entry, skipping`);
      continue;
    }

    console.log(
      `[extractFonts] Page ${pageIndex}: found /Font dict with ${fontDict.keys().length} entries`
    );

    // ---- Iterate each font alias ----
    for (const [aliasName, fontRefOrDict] of fontDict.entries()) {
      const alias = aliasName.asString();

      // Determine the indirect object reference string
      let objectRef: string;
      let resolvedFontDict: PDFDict | null;

      if (fontRefOrDict instanceof PDFRef) {
        objectRef = `${fontRefOrDict.objectNumber} ${fontRefOrDict.generationNumber} R`;
        resolvedFontDict = resolveDict(fontRefOrDict, context);
      } else {
        // Inline font dict — no separate PDF object
        objectRef = "inline";
        resolvedFontDict =
          fontRefOrDict instanceof PDFDict ? fontRefOrDict : null;
      }

      if (!resolvedFontDict) {
        console.warn(
          `[extractFonts] Page ${pageIndex}, alias "${alias}": could not resolve font dict`
        );
        continue;
      }

      // Build the FontReference
      const fontRef = buildFontReference(
        alias,
        resolvedFontDict,
        objectRef,
        pageIndex,
        context
      );

      // ---- Console output — this is what we verify in the test page ----
      console.log(
        `[extractFonts] Page ${pageIndex} | alias: "${alias}" | objectRef: "${objectRef}" | ` +
          `baseFontName: "${fontRef.baseFontName}" | subtype: "${fontRef.subtype}" | ` +
          `widths: ${fontRef.widths.length} entries | encoding: "${fontRef.encoding}"`
      );

      // Store in map; if this alias is already set (same alias on two pages) skip
      // but if it's a new alias pointing to an already-seen object, still add it
      if (!fontMap.has(alias)) {
        fontMap.set(alias, fontRef);
      }

      seenObjectRefs.add(objectRef);
    }
  }

  console.log(
    `[extractFonts] Done. Total unique font aliases: ${fontMap.size}, ` +
      `unique object refs: ${seenObjectRefs.size}`
  );

  return fontMap;
}

// ---------------------------------------------------------------------------
// getTextBlocks()
// ---------------------------------------------------------------------------

/**
 * Extracts all text blocks from a PDF with their screen positions,
 * font sizes, and resolved FontReferences.
 *
 * Strategy:
 *   - pdfjs-dist's getTextContent() gives us accurate positions, font sizes,
 *     and text strings (handling all PDF text operators and encodings).
 *   - We then cross-reference each text item's pdfjs fontName against the
 *     FontMap from extractFonts() to attach the full FontReference.
 *   - Matching is done on baseFontName (fuzzy) since pdfjs uses an internal
 *     font-id scheme that doesn't directly match PDF resource aliases.
 *
 * @param bytes   - Raw PDF bytes
 * @returns       - Array of TextBlock, one per pdfjs text item across all pages
 */
export async function getTextBlocks(bytes: Uint8Array): Promise<TextBlock[]> {
  console.log("[getTextBlocks] Initialising pdfjs and extracting text...");

  // Ensure pdfjs is initialised (no-op if already done)
  await initPdfJs();

  // Also extract fonts so we can cross-reference them
  const fontMap = await extractFonts(bytes);

  // Build a lookup by baseFontName for fuzzy matching with pdfjs fontNames.
  // Key: lowercase baseFontName (with common prefixes stripped).
  // Value: FontReference
  const byBaseName = new Map<string, FontReference>();
  for (const fontRef of fontMap.values()) {
    // PDF font names are often prefixed with a 6-char subset tag "ABCDEF+"
    const stripped = fontRef.baseFontName.replace(/^[A-Z]{6}\+/, "").toLowerCase();
    if (!byBaseName.has(stripped)) {
      byBaseName.set(stripped, fontRef);
    }
    // Also store the full baseFontName (lowercased) as a fallback key
    const full = fontRef.baseFontName.toLowerCase();
    if (!byBaseName.has(full)) {
      byBaseName.set(full, fontRef);
    }
  }

  console.log(
    `[getTextBlocks] Font cross-reference table has ${byBaseName.size} entries`
  );

  // Load the PDF with pdfjs-dist
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdfDoc = await loadingTask.promise;

  console.log(`[getTextBlocks] pdfjs loaded PDF with ${pdfDoc.numPages} page(s)`);

  const blocks: TextBlock[] = [];
  let blockIndex = 0;

  for (let pageIndex = 0; pageIndex < pdfDoc.numPages; pageIndex++) {
    const page = await pdfDoc.getPage(pageIndex + 1); // pdfjs uses 1-based page numbers

    // getTextContent returns items with accurate positions and decoded strings.
    // includeMarkedContent: false keeps the output clean (no structure elements).
    const textContent = await page.getTextContent({ includeMarkedContent: false });

    console.log(
      `[getTextBlocks] Page ${pageIndex}: ${textContent.items.length} text item(s)`
    );

    for (const item of textContent.items) {
      // Each item is a TextItem (str present) or TextMarkedContent (no str)
      // The 'str' check guards against marked-content-only items
      if (!("str" in item) || item.str.trim() === "") continue;

      const textItem = item as {
        str: string;
        transform: number[];
        width: number;
        height: number;
        fontName: string;
      };

      // PDF transform matrix: [a, b, c, d, e, f]
      // For unrotated text: a ≈ d ≈ fontSize, e = x, f = y
      const [a, b, , , e, f] = textItem.transform;
      const x = e;
      const y = f;
      // Font size from the matrix scale factor
      const fontSize = Math.round(Math.hypot(a, b) * 10) / 10 || 12;
      const width = textItem.width;
      const height = textItem.height || fontSize;

      // ---- Cross-reference: pdfjs fontName → FontReference ----
      // pdfjs fontName is an internal id like "g_d0e0_f1" or the raw alias.
      // We try several matching strategies in order of reliability.
      const pdfjsFontName = textItem.fontName;
      let matchedFontRef: FontReference | null = null;
      let matchedAlias: string | null = null;

      // Strategy 1: exact alias match (works when pdfjs preserves the alias)
      if (fontMap.has(pdfjsFontName)) {
        matchedFontRef = fontMap.get(pdfjsFontName)!;
        matchedAlias = pdfjsFontName;
      }

      // Strategy 2: the pdfjs fontName often ends with the alias after an underscore
      // e.g. "g_d0e0_F1" → extract "F1"
      if (!matchedFontRef) {
        const parts = pdfjsFontName.split("_");
        const lastPart = parts[parts.length - 1];
        if (fontMap.has(lastPart)) {
          matchedFontRef = fontMap.get(lastPart)!;
          matchedAlias = lastPart;
        }
      }

      // Strategy 3: fuzzy baseFontName match (pdfjs may embed the PostScript name)
      if (!matchedFontRef) {
        const lowerPdfjs = pdfjsFontName.toLowerCase();
        for (const [key, ref] of byBaseName.entries()) {
          if (lowerPdfjs.includes(key) || key.includes(lowerPdfjs)) {
            matchedFontRef = ref;
            matchedAlias = ref.alias;
            break;
          }
        }
      }

      if (!matchedFontRef) {
        console.warn(
          `[getTextBlocks] Page ${pageIndex}, block ${blockIndex}: ` +
            `no font match for pdfjs fontName "${pdfjsFontName}"`
        );
      } else {
        console.log(
          `[getTextBlocks] Page ${pageIndex}, block ${blockIndex}: ` +
            `"${textItem.str.substring(0, 30)}" → alias "${matchedAlias}" → ` +
            `objectRef "${matchedFontRef.objectRef}"`
        );
      }

      blocks.push({
        id: `p${pageIndex}-b${blockIndex}`,
        pageIndex,
        content: textItem.str,
        x,
        y,
        width,
        height,
        fontSize,
        fontAlias: matchedAlias,
        fontRef: matchedFontRef,
        pdfjsFontName,
      });

      blockIndex++;
    }
  }

  console.log(`[getTextBlocks] Done. Total text blocks: ${blocks.length}`);
  return blocks;
}

// ---------------------------------------------------------------------------
// calculateTextMetrics()
// ---------------------------------------------------------------------------

/**
 * Calculates the rendered width and height of a string using the font's own
 * character-width table — the same data the PDF renderer uses.
 *
 * PDF glyph widths are stored in 1/1000 of a text-space unit.
 * Multiply by (fontSize / 1000) to get the width in PDF user-space points.
 *
 * Characters outside the Widths array (charCode < firstChar or > lastChar)
 * default to width 1000 (= one em) as a safe fallback.
 *
 * @param text    - The string to measure
 * @param fontRef - FontReference with character widths and firstChar
 * @param fontSize - Font size in points
 * @returns       - { width, height } in PDF user-space points
 */
export function calculateTextMetrics(
  text: string,
  fontRef: FontReference,
  fontSize: number
): TextMetrics {
  const { widths, firstChar, lastChar } = fontRef;
  let totalWidth = 0;

  for (const char of text) {
    const charCode = char.charCodeAt(0);
    const inRange = charCode >= firstChar && charCode <= lastChar;

    if (inRange && widths.length > 0) {
      const widthIndex = charCode - firstChar;
      const glyphWidth = widths[widthIndex] ?? 1000;
      totalWidth += glyphWidth;
    } else {
      // Fallback: 1000 units = one em (approximately correct for most fonts)
      totalWidth += 1000;
    }
  }

  // Convert from 1/1000 text-space units to points
  const width = (totalWidth * fontSize) / 1000;
  const height = fontSize; // Approximation; ascent+descent data would be more precise

  console.log(
    `[calculateTextMetrics] "${text.substring(0, 20)}" at ${fontSize}pt → ` +
      `width: ${width.toFixed(2)}pt, height: ${height}pt`
  );

  return { width, height };
}

// ---------------------------------------------------------------------------
// preserveFont()
// ---------------------------------------------------------------------------

/**
 * Rewrites a single text block in the PDF's content stream with new text,
 * REUSING the same font object reference so no font is re-embedded.
 *
 * Algorithm:
 *   1. Load PDF with pdf-lib.
 *   2. Get the target page's content stream bytes (decode FlateDecode if needed).
 *   3. Convert to a Latin-1 string for text-level manipulation.
 *   4. Scan for the PDF text operator context where:
 *        - The active /Tf font alias matches block.fontAlias
 *        - The text string matches (or contains) block.content
 *        - The position is within POSITION_TOLERANCE of block.x, block.y
 *   5. Replace the string operand, keeping the Tf line untouched.
 *   6. Re-encode the stream (FlateDecode) and write it back.
 *   7. Return the modified PDF bytes via pdfDoc.save().
 *
 * Throws FontPreservationError when:
 *   - The text block cannot be located in the stream (ambiguous or not found)
 *   - The page has no content stream
 *   - block.fontAlias is null
 *
 * @param bytes   - Original PDF bytes
 * @param block   - The TextBlock to update
 * @param newText - Replacement text string
 * @returns       - Modified PDF bytes
 */
export async function preserveFont(
  bytes: Uint8Array,
  block: TextBlock,
  newText: string
): Promise<Uint8Array> {
  console.log(
    `[preserveFont] Replacing "${block.content}" → "${newText}" ` +
      `on page ${block.pageIndex}, fontAlias: ${block.fontAlias}, ` +
      `objectRef: ${block.fontRef?.objectRef ?? "unknown"}`
  );

  if (!block.fontAlias) {
    throw new FontPreservationError(
      "Cannot preserve font: no font alias available for this text block.",
      { block }
    );
  }

  const pdfDoc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    updateMetadata: false,
  });

  const pages = pdfDoc.getPages();
  if (block.pageIndex >= pages.length) {
    throw new FontPreservationError(
      `Page index ${block.pageIndex} is out of range (PDF has ${pages.length} pages).`
    );
  }

  const page = pages[block.pageIndex];
  const context = pdfDoc.context;

  // ---- Locate the single content stream ref we will modify ----
  // When there are multiple streams we must find which one contains the target.
  // For Phase 2A we read all streams combined to locate the text, then write
  // back to the *first* content stream that contained the match.
  // TODO Phase 2B: track which stream ref the match lives in for multi-stream PDFs.

  const contentsVal = page.node.get(PDFName.of("Contents"));
  if (!contentsVal) {
    throw new FontPreservationError(
      `Page ${block.pageIndex} has no content stream.`
    );
  }

  // Collect (ref, decoded bytes) pairs for each stream
  interface StreamEntry {
    ref: PDFRef;
    originalStream: PDFRawStream;
    decoded: Uint8Array;
  }
  const streamEntries: StreamEntry[] = [];

  const collectStream = (ref: PDFRef): void => {
    const obj = context.lookup(ref);
    if (obj instanceof PDFRawStream) {
      streamEntries.push({ ref, originalStream: obj, decoded: decodeStream(obj) });
    }
  };

  if (contentsVal instanceof PDFRef) {
    collectStream(contentsVal);
  } else if (contentsVal instanceof PDFArray) {
    for (const item of contentsVal.asArray()) {
      if (item instanceof PDFRef) collectStream(item);
    }
  }

  if (streamEntries.length === 0) {
    throw new FontPreservationError(
      `Page ${block.pageIndex}: content stream(s) could not be read.`
    );
  }

  // ---- Convert all decoded bytes to a combined Latin-1 string for scanning ----
  // Latin-1 preserves all byte values 0x00–0xFF without corruption, which is
  // essential for binary PDF string data.
  const decoder = new TextDecoder("latin1");
  const allDecodedText = streamEntries.map((e) => decoder.decode(e.decoded));

  // ---- Find and replace the text ----
  const { streamIndex, modifiedText } = locateAndReplaceText(
    allDecodedText,
    block,
    newText
  );

  // ---- Write modified text back to the correct stream ----
  const encoder = new TextEncoder(); // UTF-8 — but for Latin-1 content this is safe
  // For pure Latin-1 content, we need to re-encode as Latin-1 bytes, not UTF-8.
  const modifiedBytes = latinEncode(modifiedText);

  const entry = streamEntries[streamIndex];
  const newStream = encodeStream(modifiedBytes, entry.originalStream);

  // Replace the stream object in the PDF context
  context.assign(entry.ref, newStream);

  console.log(
    `[preserveFont] Stream ${streamIndex} modified. Saving PDF...`
  );

  const savedBytes = await pdfDoc.save();
  console.log(
    `[preserveFont] Done. Output size: ${savedBytes.length} bytes ` +
      `(original: ${bytes.length} bytes)`
  );

  return savedBytes;
}

// ---------------------------------------------------------------------------
// preserveFont() helpers
// ---------------------------------------------------------------------------

/**
 * Converts a string (containing only Latin-1 characters) back to a Uint8Array
 * using latin-1 encoding. TextEncoder only produces UTF-8, so we must do this
 * manually to preserve byte-exact PDF string data.
 */
function latinEncode(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Encodes a plain text string into a PDF literal string operand.
 *
 * PDF literal strings are enclosed in parentheses. Special characters
 * `(`, `)`, and `\` must be backslash-escaped. Non-printable bytes are
 * left as-is (PDF readers handle them via the font's encoding map).
 *
 * Example: "Hello (World)" → "(Hello \\(World\\))"
 */
function encodePdfLiteralString(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\") // must be first
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  return `(${escaped})`;
}

/**
 * How close (in PDF user-space points) a content stream position must be to
 * the TextBlock coordinates before we consider it a match.
 * PDF coordinates use 72 points/inch; ±5 pt ≈ ±1.8 mm.
 */
const POSITION_TOLERANCE = 5;

/**
 * Scans an array of decoded content stream strings to find the text operator
 * matching the target TextBlock, then replaces the string operand with
 * newText. Returns the index of the stream that was modified and its new text.
 *
 * Match criteria (all must be satisfied):
 *   1. Active font alias (from most recent Tf) matches block.fontAlias
 *   2. Current position (from most recent Td / Tm) is within POSITION_TOLERANCE
 *   3. The text string matches block.content (exact or contained)
 *
 * Currently handles:
 *   - Literal string Tj:  (text) Tj
 *   - Hex string Tj:      <hex> Tj
 *   - TJ arrays:          [(text)] TJ  (replaces first string in the array)
 *
 * Throws FontPreservationError if no match is found across all streams.
 */
function locateAndReplaceText(
  streamTexts: string[],
  block: TextBlock,
  newText: string
): { streamIndex: number; modifiedText: string } {
  const targetAlias = block.fontAlias!;
  const targetContent = block.content;
  const targetX = block.x;
  const targetY = block.y;

  console.log(
    `[locateAndReplaceText] Searching for "${targetContent}" near (${targetX.toFixed(1)}, ${targetY.toFixed(1)}) ` +
      `with font alias "${targetAlias}"`
  );

  for (let si = 0; si < streamTexts.length; si++) {
    const text = streamTexts[si];
    const result = tryReplaceInStream(
      text,
      targetAlias,
      targetContent,
      targetX,
      targetY,
      newText
    );
    if (result !== null) {
      console.log(`[locateAndReplaceText] Match found in stream ${si}`);
      return { streamIndex: si, modifiedText: result };
    }
  }

  throw new FontPreservationError(
    `Could not locate text "${targetContent}" in the content stream for font "${targetAlias}". ` +
      `Font preservation is not possible for this text block.`,
    {
      blockId: block.id,
      targetAlias,
      targetContent,
      position: { x: targetX, y: targetY },
    }
  );
}

/**
 * Attempts text replacement within a single decoded content stream string.
 *
 * Uses a simple line-by-line token scan rather than a full PDF parser —
 * sufficient for the vast majority of real-world PDFs.
 *
 * State machine tracks:
 *   - currentAlias: set by "/<alias> <size> Tf" lines
 *   - currentX, currentY: updated by "x y Td", "x y TD", and "a b c d x y Tm"
 *   - inTextBlock: true between BT and ET markers
 *
 * Returns the modified stream text, or null if no match was found.
 */
function tryReplaceInStream(
  stream: string,
  targetAlias: string,
  targetContent: string,
  targetX: number,
  targetY: number,
  newText: string
): string | null {
  // Split into tokens (PDF streams use spaces and newlines between operators)
  // We process token-by-token using a cursor approach.
  const tokens = tokenizeContentStream(stream);
  const resultTokens = [...tokens]; // we'll modify this array in-place

  let currentAlias = "";
  let currentX = 0;
  let currentY = 0;
  let inText = false;

  // We need raw token indices to know where to do substitutions
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i].value;

    if (tok === "BT") {
      inText = true;
      i++;
      continue;
    }
    if (tok === "ET") {
      inText = false;
      i++;
      continue;
    }

    if (!inText) {
      i++;
      continue;
    }

    // ---- Tf: set font alias and size ----
    // Pattern: /<alias> <size> Tf
    if (tok === "Tf" && i >= 2) {
      const sizeToken = tokens[i - 1];
      const aliasToken = tokens[i - 2];
      if (
        sizeToken.type === "number" &&
        aliasToken.type === "name"
      ) {
        currentAlias = aliasToken.value.replace(/^\//, "");
      }
      i++;
      continue;
    }

    // ---- Td / TD: translate text position ----
    // Pattern: <dx> <dy> Td
    if ((tok === "Td" || tok === "TD") && i >= 2) {
      const dyToken = tokens[i - 1];
      const dxToken = tokens[i - 2];
      if (dyToken.type === "number" && dxToken.type === "number") {
        currentX += parseFloat(dxToken.value);
        currentY += parseFloat(dyToken.value);
      }
      i++;
      continue;
    }

    // ---- Tm: set text matrix ----
    // Pattern: a b c d e f Tm  — e=x, f=y in user space
    if (tok === "Tm" && i >= 6) {
      const fToken = tokens[i - 1]; // y
      const eToken = tokens[i - 2]; // x
      if (fToken.type === "number" && eToken.type === "number") {
        currentX = parseFloat(eToken.value);
        currentY = parseFloat(fToken.value);
      }
      i++;
      continue;
    }

    // ---- Tj: show text string ----
    // Pattern: (string) Tj  or  <hex> Tj
    if (tok === "Tj" && i >= 1) {
      const strToken = tokens[i - 1];
      if (
        (strToken.type === "string-literal" || strToken.type === "string-hex") &&
        currentAlias === targetAlias &&
        positionMatch(currentX, currentY, targetX, targetY) &&
        textMatch(strToken, targetContent)
      ) {
        console.log(
          `[tryReplaceInStream] Tj match at (${currentX.toFixed(1)}, ${currentY.toFixed(1)}) ` +
            `alias="${currentAlias}", original="${strToken.value}"`
        );
        // Replace the string token with the new encoded literal
        resultTokens[i - 1] = {
          ...strToken,
          value: encodePdfLiteralString(newText),
          type: "string-literal",
        };
        return resultTokens.map((t) => t.value).join(" ");
      }
      i++;
      continue;
    }

    // ---- TJ: show text array ----
    // Pattern: [(string) offset (string) ...] TJ
    // We replace the first string element in the array.
    if (tok === "TJ" && i >= 1) {
      const arrToken = tokens[i - 1];
      if (
        arrToken.type === "array" &&
        currentAlias === targetAlias &&
        positionMatch(currentX, currentY, targetX, targetY) &&
        arrayTextMatch(arrToken.value, targetContent)
      ) {
        console.log(
          `[tryReplaceInStream] TJ match at (${currentX.toFixed(1)}, ${currentY.toFixed(1)}) ` +
            `alias="${currentAlias}"`
        );
        const newArray = replaceFirstStringInTJArray(arrToken.value, newText);
        resultTokens[i - 1] = { ...arrToken, value: newArray };
        return resultTokens.map((t) => t.value).join(" ");
      }
      i++;
      continue;
    }

    i++;
  }

  return null; // no match in this stream
}

/** Checks whether two PDF user-space positions are within POSITION_TOLERANCE. */
function positionMatch(x1: number, y1: number, x2: number, y2: number): boolean {
  return Math.abs(x1 - x2) <= POSITION_TOLERANCE && Math.abs(y1 - y2) <= POSITION_TOLERANCE;
}

/** Checks whether a decoded string token contains the target text. */
function textMatch(token: Token, target: string): boolean {
  const decoded =
    token.type === "string-hex" ? decodeHexString(token.value) : decodeLiteralString(token.value);
  return decoded.includes(target) || target.includes(decoded.trim());
}

/** Checks whether a TJ array token contains text matching the target. */
function arrayTextMatch(arrayStr: string, target: string): boolean {
  // Extract all string literals from the array content
  const combined = extractStringsFromTJArray(arrayStr);
  return combined.includes(target) || target.includes(combined.trim());
}

/**
 * Replaces the first string element in a TJ array operand with new text.
 *
 * Input example:  "[(Hello) 10 (World)]"
 * Output example: "[(New text) 10 (World)]"
 */
function replaceFirstStringInTJArray(arrayStr: string, newText: string): string {
  // Remove outer [ and ]
  const inner = arrayStr.slice(1, -1).trim();
  // Replace the first (...) occurrence
  const replaced = inner.replace(/\(([^)\\]|\\.)*\)/, encodePdfLiteralString(newText));
  return `[${replaced}]`;
}

/** Extracts and concatenates all literal strings from a TJ array. */
function extractStringsFromTJArray(arrayStr: string): string {
  const matches = arrayStr.match(/\(([^)\\]|\\.)*\)/g) ?? [];
  return matches
    .map((m) => decodeLiteralString(m))
    .join("");
}

/** Decodes a PDF literal string (removes enclosing parens, unescapes backslashes). */
function decodeLiteralString(s: string): string {
  return s
    .slice(1, -1)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

/** Decodes a PDF hex string (removes angle brackets, converts hex pairs to chars). */
function decodeHexString(s: string): string {
  const hex = s.slice(1, -1).replace(/\s/g, "");
  let result = "";
  for (let i = 0; i < hex.length; i += 2) {
    result += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Minimal content stream tokeniser
// ---------------------------------------------------------------------------

/**
 * Token types produced by tokenizeContentStream.
 * We only distinguish the token types we need for text operator matching.
 */
type TokenType =
  | "operator"
  | "number"
  | "name"
  | "string-literal"
  | "string-hex"
  | "array"
  | "other";

interface Token {
  type: TokenType;
  value: string;
}

/**
 * Tokenises a decoded PDF content stream into an array of Tokens.
 *
 * This is a purposely minimal tokeniser — it handles the constructs we need
 * to match and replace text operators. It correctly handles:
 *   - Parenthesised strings (including nested parens and backslash escapes)
 *   - Hex strings <...>
 *   - Arrays [...] (used by TJ)
 *   - Names /Name
 *   - Numbers (integer and real, including negatives)
 *   - Operator keywords (BT, ET, Tf, Td, TD, Tm, Tj, TJ, etc.)
 *   - Comments (% to end of line — skipped)
 */
function tokenizeContentStream(stream: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = stream.length;

  while (i < len) {
    const ch = stream[i];

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f") {
      i++;
      continue;
    }

    // Skip comments
    if (ch === "%") {
      while (i < len && stream[i] !== "\n" && stream[i] !== "\r") i++;
      continue;
    }

    // Parenthesised literal string — handle nested parens and escapes
    if (ch === "(") {
      let depth = 1;
      let j = i + 1;
      while (j < len && depth > 0) {
        if (stream[j] === "\\") {
          j += 2; // skip escaped char
          continue;
        }
        if (stream[j] === "(") depth++;
        else if (stream[j] === ")") depth--;
        j++;
      }
      tokens.push({ type: "string-literal", value: stream.slice(i, j) });
      i = j;
      continue;
    }

    // Hex string
    if (ch === "<" && stream[i + 1] !== "<") {
      const end = stream.indexOf(">", i + 1);
      if (end === -1) { i++; continue; }
      tokens.push({ type: "string-hex", value: stream.slice(i, end + 1) });
      i = end + 1;
      continue;
    }

    // Array (used by TJ operator)
    if (ch === "[") {
      // Find matching ] (arrays don't nest in content streams)
      let depth = 1;
      let j = i + 1;
      while (j < len && depth > 0) {
        if (stream[j] === "\\") { j += 2; continue; }
        if (stream[j] === "(") {
          // Skip string inside array
          let pd = 1; j++;
          while (j < len && pd > 0) {
            if (stream[j] === "\\") { j++; }
            else if (stream[j] === "(") pd++;
            else if (stream[j] === ")") pd--;
            j++;
          }
          continue;
        }
        if (stream[j] === "[") depth++;
        else if (stream[j] === "]") depth--;
        j++;
      }
      tokens.push({ type: "array", value: stream.slice(i, j) });
      i = j;
      continue;
    }

    // Name object /Foo
    if (ch === "/") {
      let j = i + 1;
      while (j < len && !/[\s\[\]<>(){}/%]/.test(stream[j])) j++;
      tokens.push({ type: "name", value: stream.slice(i, j) });
      i = j;
      continue;
    }

    // Number (integer or real, possibly negative)
    if (ch === "-" || ch === "+" || (ch >= "0" && ch <= "9") || ch === ".") {
      let j = i;
      if (stream[j] === "-" || stream[j] === "+") j++;
      while (j < len && ((stream[j] >= "0" && stream[j] <= "9") || stream[j] === ".")) j++;
      if (j > i + (stream[i] === "-" || stream[i] === "+" ? 1 : 0)) {
        tokens.push({ type: "number", value: stream.slice(i, j) });
        i = j;
        continue;
      }
    }

    // Operator keyword or other bare token
    if (/[a-zA-Z*'"]/.test(ch)) {
      let j = i;
      while (j < len && /[a-zA-Z0-9*'"_]/.test(stream[j])) j++;
      const word = stream.slice(i, j);
      const ops = new Set([
        "BT", "ET", "Tf", "Td", "TD", "Tm", "T*", "Tj", "TJ", "'", '"',
        "cm", "q", "Q", "re", "W", "n", "m", "l", "c", "v", "y", "h",
        "S", "s", "F", "f", "B", "b", "g", "G", "rg", "RG", "k", "K",
        "Do", "BI", "ID", "EI", "BMC", "BDC", "EMC", "MP", "DP",
        "Tc", "Tw", "Tz", "TL", "Tr", "Ts", "w", "J", "j", "M", "d", "ri", "i", "gs",
        "CS", "cs", "SC", "sc", "SCN", "scn", "sh",
      ]);
      tokens.push({ type: ops.has(word) ? "operator" : "other", value: word });
      i = j;
      continue;
    }

    // Skip any other character (e.g. << >> for dict markers in stream headers)
    i++;
  }

  return tokens;
}
