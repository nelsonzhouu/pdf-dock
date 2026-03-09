"use client";
/**
 * app/test-parser/page.tsx
 *
 * Developer test page for Phase 2A — validates the PDF stream parser.
 *
 * What this page does:
 *   1. Accepts a PDF file upload
 *   2. Calls extractFonts() and getTextBlocks() from lib/pdf-parser.ts
 *   3. Displays every font's objectRef (e.g. "5 0 R") on screen so we can
 *      verify that font object references are being captured correctly
 *   4. Displays the first 50 text blocks with their position and font mapping
 *   5. Logs everything to the browser console for deeper inspection
 *
 * IMPORTANT: This page is for development/debugging only.
 * It should be removed or protected before production deployment.
 */

import { useState, useCallback } from "react";
import { extractFonts, getTextBlocks } from "@/lib/pdf-parser";
import type { FontReference, TextBlock } from "@/lib/types";
import { MIME_PDF, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_LABEL } from "@/utils/constants";

// ---------------------------------------------------------------------------
// Types for local state
// ---------------------------------------------------------------------------

interface ParseResult {
  fonts: FontReference[];
  blocks: TextBlock[];
  fileName: string;
  fileSizeKb: number;
  parseTimeMs: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TestParserPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<"fonts" | "blocks">("fonts");

  // ---- File upload handler ----
  const handleFile = useCallback(async (file: File) => {
    // Validate type
    if (file.type !== MIME_PDF && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a valid PDF file.");
      setStatus("error");
      return;
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File too large (max ${MAX_FILE_SIZE_LABEL}).`);
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      const startMs = performance.now();

      // Read file as ArrayBuffer then convert to Uint8Array
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      console.group(`[test-parser] Parsing: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

      // Run extractFonts and getTextBlocks concurrently where possible.
      // getTextBlocks internally calls extractFonts too, but having both
      // here gives us the raw FontMap to display independently.
      const [fontMap, blocks] = await Promise.all([
        extractFonts(bytes),
        getTextBlocks(bytes),
      ]);

      const parseTimeMs = Math.round(performance.now() - startMs);

      // Convert FontMap to array for display
      const fonts = Array.from(fontMap.values());

      console.log("\n=== FONT SUMMARY ===");
      console.table(
        fonts.map((f) => ({
          alias: f.alias,
          objectRef: f.objectRef,   // ← THIS is what we verify
          baseFontName: f.baseFontName,
          subtype: f.subtype,
          encoding: f.encoding,
          widthsCount: f.widths.length,
          firstChar: f.firstChar,
          lastChar: f.lastChar,
        }))
      );

      console.log("\n=== TEXT BLOCKS (first 20) ===");
      console.table(
        blocks.slice(0, 20).map((b) => ({
          id: b.id,
          content: b.content.substring(0, 30),
          x: b.x.toFixed(1),
          y: b.y.toFixed(1),
          fontSize: b.fontSize,
          fontAlias: b.fontAlias,
          fontObjectRef: b.fontRef?.objectRef ?? "no match",
        }))
      );

      console.groupEnd();

      setResult({ fonts, blocks, fileName: file.name, fileSizeKb: file.size / 1024, parseTimeMs });
      setStatus("done");
    } catch (err) {
      console.error("[test-parser] Error:", err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setStatus("error");
      console.groupEnd();
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ---- Render ----
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🔬</span>
          <h1 className="text-2xl font-bold text-gray-900">PDF Parser Test</h1>
          <span className="ml-2 rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
            Dev only
          </span>
        </div>
        <p className="text-sm text-gray-600">
          Phase 2A validation tool — verifies that font{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">objectRef</code> values
          (e.g.{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono">5 0 R</code>)
          are captured correctly. Open the browser console for full output.
        </p>
      </div>

      {/* Upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="mb-6 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center"
      >
        <p className="mb-3 text-sm text-gray-600">Drop a PDF here or</p>
        <label className="cursor-pointer rounded border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50">
          Choose PDF file
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handleInputChange}
          />
        </label>
        <p className="mt-2 text-xs text-gray-400">Max {MAX_FILE_SIZE_LABEL}</p>
      </div>

      {/* Loading */}
      {status === "loading" && (
        <div className="rounded border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
          Parsing PDF — this may take a few seconds for large files…
        </div>
      )}

      {/* Error */}
      {status === "error" && error && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {status === "done" && result && (
        <div>
          {/* Summary bar */}
          <div className="mb-4 rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <strong>File:</strong> {result.fileName}
            </span>
            <span>
              <strong>Size:</strong> {result.fileSizeKb.toFixed(1)} KB
            </span>
            <span>
              <strong>Fonts:</strong> {result.fonts.length} alias(es)
            </span>
            <span>
              <strong>Text blocks:</strong> {result.blocks.length}
            </span>
            <span>
              <strong>Parse time:</strong> {result.parseTimeMs} ms
            </span>
          </div>

          {/* Tab switcher */}
          <div className="mb-4 flex gap-2 border-b border-gray-200">
            <button
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === "fonts"
                  ? "border-b-2 border-gray-900 text-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setActiveTab("fonts")}
            >
              Fonts ({result.fonts.length})
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === "blocks"
                  ? "border-b-2 border-gray-900 text-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setActiveTab("blocks")}
            >
              Text Blocks ({result.blocks.length})
            </button>
          </div>

          {/* Fonts table */}
          {activeTab === "fonts" && (
            <div className="overflow-x-auto">
              <p className="mb-2 text-xs text-gray-500">
                The <strong>Object Ref</strong> column is the key value — it must show a PDF
                indirect reference (e.g.{" "}
                <code className="font-mono">5 0 R</code>) for font preservation to work.
              </p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-xs text-gray-600">
                    <th className="border border-gray-200 px-3 py-2">Alias</th>
                    <th className="border border-gray-200 px-3 py-2 bg-yellow-50">
                      Object Ref ★
                    </th>
                    <th className="border border-gray-200 px-3 py-2">Base Font Name</th>
                    <th className="border border-gray-200 px-3 py-2">Subtype</th>
                    <th className="border border-gray-200 px-3 py-2">Encoding</th>
                    <th className="border border-gray-200 px-3 py-2">Widths</th>
                    <th className="border border-gray-200 px-3 py-2">First Char</th>
                    <th className="border border-gray-200 px-3 py-2">Page</th>
                  </tr>
                </thead>
                <tbody>
                  {result.fonts.map((font, idx) => (
                    <tr
                      key={idx}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="border border-gray-200 px-3 py-2 font-mono text-xs">
                        {font.alias}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 bg-yellow-50">
                        <code
                          className={`font-mono text-xs font-bold ${
                            font.objectRef === "inline"
                              ? "text-orange-600"
                              : "text-green-700"
                          }`}
                        >
                          {font.objectRef}
                        </code>
                      </td>
                      <td className="border border-gray-200 px-3 py-2 font-mono text-xs">
                        {font.baseFontName}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-xs">
                        {font.subtype}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-xs">
                        {font.encoding ?? "—"}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-xs text-center">
                        {font.widths.length}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-xs text-center">
                        {font.firstChar}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-xs text-center">
                        {font.firstSeenOnPage}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Text blocks table */}
          {activeTab === "blocks" && (
            <div className="overflow-x-auto">
              <p className="mb-2 text-xs text-gray-500">
                Showing first 50 blocks. The{" "}
                <strong>Font Object Ref</strong> column shows whether font matching
                succeeded. &ldquo;no match&rdquo; means the block will need the fallback overlay.
              </p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-xs text-gray-600">
                    <th className="border border-gray-200 px-3 py-2">ID</th>
                    <th className="border border-gray-200 px-3 py-2">Content</th>
                    <th className="border border-gray-200 px-3 py-2">Page</th>
                    <th className="border border-gray-200 px-3 py-2">X</th>
                    <th className="border border-gray-200 px-3 py-2">Y</th>
                    <th className="border border-gray-200 px-3 py-2">Size</th>
                    <th className="border border-gray-200 px-3 py-2">Font Alias</th>
                    <th className="border border-gray-200 px-3 py-2 bg-yellow-50">
                      Font Object Ref ★
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.blocks.slice(0, 50).map((block, idx) => (
                    <tr
                      key={block.id}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="border border-gray-200 px-3 py-2 font-mono text-xs">
                        {block.id}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-xs max-w-xs truncate">
                        {block.content}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-xs text-center">
                        {block.pageIndex}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 font-mono text-xs">
                        {block.x.toFixed(1)}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 font-mono text-xs">
                        {block.y.toFixed(1)}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-xs text-center">
                        {block.fontSize}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 font-mono text-xs">
                        {block.fontAlias ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 bg-yellow-50">
                        <code
                          className={`font-mono text-xs font-bold ${
                            block.fontRef
                              ? "text-green-700"
                              : "text-red-500"
                          }`}
                        >
                          {block.fontRef?.objectRef ?? "no match"}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.blocks.length > 50 && (
                <p className="mt-2 text-xs text-gray-500 text-center">
                  + {result.blocks.length - 50} more blocks — see browser console for full list
                </p>
              )}
            </div>
          )}

          {/* Raw JSON dump */}
          <details className="mt-6">
            <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">
              Raw font data (JSON)
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded border border-gray-200 bg-gray-50 p-4 text-xs">
              {JSON.stringify(result.fonts, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </main>
  );
}
