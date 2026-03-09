# PDFDock

A production-ready, browser-based PDF toolkit. All processing happens **client-side** — files never leave your device.

## Features

| Tool | Description |
|------|-------------|
| Edit PDF | Seamless inline text editing with real-time preview — edit PDFs like a document editor with live text rendering and original font preservation |
| Merge PDF | Combine multiple PDFs with drag-and-drop reordering |
| Split PDF | Extract pages or ranges; download as ZIP |
| Compress PDF | Reduce file size with metadata removal and object streams |
| PDF → Image | Export each page as PNG or JPG at configurable DPI |
| Image → PDF | Combine images into a single PDF with page-size options |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14+ (App Router), React 18, TypeScript 5 |
| Styling | Tailwind CSS 3 |
| PDF Manipulation | pdf-lib 1.x |
| PDF Rendering | pdfjs-dist 4.x |
| Database | Supabase (PostgreSQL) — global counters only |
| Payments | Stripe Checkout |
| Deployment | Vercel |

---

## Architecture

### Client-Side Processing (Privacy First)

Every PDF operation runs entirely in the browser using Web APIs. No PDF bytes are ever sent to a server. The Next.js backend handles only two responsibilities:

1. **`/api/track-usage`** — increments a global processed-document counter in Supabase
2. **`/api/create-checkout-session`** — creates a Stripe Checkout session server-side (required to keep the Stripe secret key off the client)

### PDF Editing — Raw Stream Parsing Approach

The editor does **not** re-embed fonts via WASM. Instead it follows a lightweight strategy:

1. **Parse the raw PDF binary stream** using `pdf-lib`'s internal object model to locate `/Font` entries in each page's resource dictionary.
2. **Extract existing font dictionaries** — base font name, subtype (`/Type1`, `/TrueType`, etc.), encoding, character-width tables, and the PDF indirect object reference (e.g., `5 0 R`).
3. **Map new text inline** — when the user edits a text block, the same font object reference already in the PDF is reused. No new font is created or embedded.
4. **Calculate metrics** using the original character-width tables to position text correctly.
5. **Fallback to overlay** if a font dictionary is missing or corrupted (rare).

This produces ~90 % font fidelity with a fraction of the overhead of WASM-based re-embedding.

---

## Project Structure

```
pdfdock/
├── app/
│   ├── page.tsx                           # Homepage — feature cards + global stats
│   ├── layout.tsx                         # Root layout (Header + Footer)
│   ├── edit-pdf/page.tsx                  # PDF editor
│   ├── merge-pdf/page.tsx                 # PDF merger
│   ├── split-pdf/page.tsx                 # PDF splitter
│   ├── compress-pdf/page.tsx              # PDF compressor
│   ├── pdf-to-image/page.tsx              # PDF → Image converter
│   ├── image-to-pdf/page.tsx              # Image → PDF converter
│   ├── donate/
│   │   ├── page.tsx                       # Donation page
│   │   └── success/page.tsx               # Post-donation thank-you
│   ├── about/page.tsx                     # About + privacy policy
│   ├── test-parser/page.tsx               # Dev page to validate PDF parser
│   └── api/
│       ├── track-usage/route.ts           # Supabase counter increment
│       └── create-checkout-session/route.ts  # Stripe session creation
│
├── components/
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── FeatureCard.tsx
│   ├── DonationPopup.tsx                  # Post-download donation nudge
│   ├── LoadingSpinner.tsx
│   ├── ErrorMessage.tsx
│   ├── SuccessNotification.tsx
│   └── PDFEditor/
│       ├── PDFCanvas.tsx                  # PDF render + click detection
│       ├── TextEditor.tsx                 # Inline text editor
│       ├── EditorToolbar.tsx              # Font / size / color toolbar
│       └── FontPreserver.tsx             # Font preservation orchestrator
│
├── lib/
│   ├── supabase.ts                        # Supabase client
│   ├── pdf-parser.ts                      # Raw PDF stream parser
│   └── types.ts                           # Shared TypeScript types
│
├── utils/
│   └── constants.ts                       # File limits and app-wide constants
│
├── .env.example                           # Environment variable template
├── README.md
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── next.config.js
```

---

## Development Phases

### Phase 1 — Foundation & Infrastructure
**Goal:** Working app skeleton with navigation and Supabase analytics.

- Initialize Next.js 14+ with TypeScript and Tailwind CSS
- Homepage with hero, 6 feature cards, and live global document count from Supabase
- Header and Footer components with full navigation
- Stub routes for all 6 tools, donate, and about pages
- Supabase `usage_stats` table and `/api/track-usage` route
- `.env.example` with all required variables

**Success criteria:** `npm run dev` runs; homepage displays; Supabase counter increments on API call.

---

### Phase 2A — PDF Editor: Parser & Font Extraction
**Goal:** Build the raw-stream PDF parser that underpins the editor.

- Install `pdf-lib` and `pdfjs-dist`
- `/lib/pdf-parser.ts` implementing:
  - `extractFonts(bytes)` — returns font dictionaries including object references
  - `getTextBlocks(bytes)` — returns positioned text blocks with font refs
  - `preserveFont(bytes, block, newText)` — rewrites text reusing existing font ref
  - `calculateTextMetrics(text, fontRef)` — uses character-width tables for sizing
- `/lib/types.ts` with `FontDictionary`, `FontReference`, `TextBlock`
- `/app/test-parser/page.tsx` dev page to upload a PDF and inspect parser output

**Success criteria:** Uploading any PDF surfaces font object references and accurate text positions in the test page.

---

### Phase 2B — PDF Editor: UI & Text Editing
**Goal:** Visual editor built on top of the parser.

- `/app/edit-pdf/page.tsx` — file upload, canvas render, click-to-edit
- `PDFCanvas.tsx` — renders PDF with pdfjs-dist; invisible hit-regions with seamless inline editing
- `TextEditor.tsx` — borderless inline input with font approximation; live preview on commit
- `EditorToolbar.tsx` — font selector (PDF fonts only), size, alignment, color
- `FontPreserver.tsx` — calls `preserveFont()` and triggers download
- Supabase usage tracking on download
- Warning displayed when font cannot be preserved

**Success criteria:** Click text → cursor appears in-place → type → live preview shows edits immediately → download with original fonts preserved ~90 % of the time.

---

### Phase 3 — Merge PDF
**Goal:** Combine multiple PDFs in user-defined order.

- Multi-file upload; list with reorder (up/down) and remove controls
- pdf-lib merge in display order
- Download merged PDF + Supabase tracking
- Validation: PDF only, ≤50 MB each, ≥2 files required

**Success criteria:** Merged PDF contains all pages in the correct sequence.

---

### Phase 4 — Split PDF
**Goal:** Extract arbitrary page ranges from a PDF.

- Single PDF upload; display page count
- Range input accepting formats like `1-3, 5, 7-9`
- Creates separate PDFs per range; bundles multiple outputs in a ZIP
- Validation: PDF only, ≤50 MB, ≤500 pages, ranges within bounds

**Success criteria:** Downloaded ZIP contains correctly split PDFs.

---

### Phase 5 — PDF ↔ Image Conversion
**Goal:** Two-way conversion between PDFs and images.

**PDF → Image**
- pdfjs-dist renders each page to a canvas
- Format selector (PNG / JPG) and DPI selector (72 / 150 / 300)
- All images bundled in a ZIP for download

**Image → PDF**
- Multi-image upload (PNG, JPG, WEBP, GIF), preview grid, reorder, remove
- Page size selector (A4 / Letter / Fit to image)
- pdf-lib embeds each image on its own page

**Success criteria:** Round-trip conversion is visually lossless at 150 DPI; up to 100 images supported.

---

### Phase 6 — Compress PDF
**Goal:** Reduce PDF file size using pure-JS techniques.

- Single PDF upload; compression level selector (Low / Medium / High)
- pdf-lib: remove metadata, apply object streams, deduplicate resources
- Show before/after size and percentage saved before download

**Success criteria:** File size visibly reduced; output opens correctly in all major PDF viewers.

---

### Phase 7 — Stripe Donation Integration
**Goal:** Optional donation flow with post-download nudge.

- `/app/donate/page.tsx` — preset amounts ($3 / $5 / $10) + custom input (≥$1)
- `/app/donate/success/page.tsx` — thank-you page
- `/api/create-checkout-session/route.ts` — server-side Stripe session creation
- `DonationPopup.tsx` — shown after any download; dismissible; 24-hour localStorage cooldown

**Success criteria:** Full Stripe Checkout flow works in test mode; popup respects cooldown.

---

### Phase 8 — About Page & UX Polish
**Goal:** Informational page and production-quality UX.

- `/app/about/page.tsx` — feature overview, privacy policy, tech credits, FAQ
- Loading spinners, progress indicators, and user-friendly error messages across all tools
- Mobile-responsive layouts and touch-friendly controls
- Reusable `LoadingSpinner`, `ErrorMessage`, `SuccessNotification` components

**Success criteria:** All pages fully functional on mobile; no raw error objects exposed to users.

---

### Phase 9 — Documentation & Deployment
**Goal:** Ship to production with complete documentation.

- README finalized (this document)
- JSDoc on all utility functions; header comments in every file
- `.env.example` reviewed and complete
- `npm run build` passes with zero errors
- Deploy to Vercel; configure environment variables in the Vercel dashboard
- Smoke-test all six tools in the production environment

**Success criteria:** Fresh clone → `npm install` → configure `.env.local` → `npm run dev` works without manual steps.

---

## Local Development

### Prerequisites

- Node.js 18+
- npm or yarn
- A Supabase project (free tier is sufficient)
- A Stripe account (test mode keys for development)

### Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd pdfdock

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase and Stripe credentials

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Supabase Setup

Run this SQL in the Supabase SQL editor to create the required table:

```sql
create table usage_stats (
  id uuid primary key default gen_random_uuid(),
  total_documents_processed bigint not null default 0,
  last_updated timestamptz not null default now()
);

-- Insert the single stats row
insert into usage_stats (total_documents_processed) values (0);
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in each value.

```env
# Supabase — required for the global document counter
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Stripe — required for the donation flow
# Use sk_test_… / pk_test_… during development
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

**Security notes:**
- `STRIPE_SECRET_KEY` is used only in the `/api/create-checkout-session` route — it is never sent to the browser.
- The Supabase anon key is safe to expose publicly; ensure your Supabase row-level security policies only allow the operations the app needs (increment a single counter row).

---

## Deployment (Vercel)

1. Push the repository to GitHub / GitLab / Bitbucket.
2. Import the project in the [Vercel dashboard](https://vercel.com/new).
3. Add all environment variables from `.env.example` under **Settings → Environment Variables**.
4. Deploy. Vercel will run `npm run build` automatically.

For production, replace test Stripe keys with live keys (`sk_live_…` / `pk_live_…`).

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| PDF content privacy | All processing is client-side; PDF bytes never reach any server |
| Stripe secret key exposure | Key exists only in Next.js API route (server runtime); never in client bundle |
| Supabase write access | API route validates the request before incrementing; RLS restricts direct client writes |
| Input validation | MIME type check, 50 MB file size cap, 500-page limit enforced before any processing |
| Filename sanitisation | Output filenames are generated programmatically; user-supplied names are sanitised before use |
| XSS | React's default escaping prevents XSS; no `dangerouslySetInnerHTML` used |
| Rate limiting | `/api/track-usage` and `/api/create-checkout-session` should be protected with Vercel's Edge Config rate limiting or a middleware guard in production |

---

## Known Limitations

- **File size:** 50 MB per file (browser memory constraint)
- **Page count:** 500 pages per PDF
- **Font preservation:** ~90 % success rate — complex or subset-encoded fonts may fall back to an overlay layer
- **Compression:** Metadata removal and object streams only; image downsampling is not implemented in v1
- **Browser support:** Modern browsers only — Chrome, Firefox, Safari, and Edge (latest two major versions)

---

## Future Improvements (V2 Ideas)

- Advanced compression with image downsampling
- OCR for scanned PDFs (Tesseract.js)
- PDF form filling
- Digital signatures
- Batch processing (multiple files in one session)
- PWA / offline mode
- Password protection and removal
- Rotate, crop, and watermark pages
- Text extraction to plain text / DOCX

---

## License

MIT — see [LICENSE](LICENSE) for details.
