# Preview Galleries with Watermarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photographers can toggle a gallery into "preview" mode. In that mode, clients only see and download 1200px watermarked copies.

**Architecture:** Every upload also produces a watermarked copy under an unrelated random key. A gallery flag decides which URLs a Postgres function hands to the public. Row-level security hides the clean URLs from direct anon reads.

**Tech Stack:** Express on Vercel Functions, sharp (with Pango text and a bundled font file), Supabase Postgres (row-level security and an RPC), Cloudflare R2, React with Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-10-preview-watermarks-design.md`

## Global Constraints

- Watermark text: `Bean & Grain · Photography by <photographer_name>`. White, about 35% opacity, repeated diagonally at -30°, styled identically on every photo.
- Watermarked output: JPEG at quality 82, long edge 1200px, never upscaled.
- Watermarked key: `<galleryId>/w/<uuidv4>.jpg`, using a UUID unrelated to the photo's other keys.
- Watermark source: the clean preview object, never the original.
- Font: `server/fonts/Inter-Medium.ttf`, passed as `fontfile`. Don't depend on system fonts.
- In preview mode, clients never receive a URL that contains `_original.` or `_preview.`.
- Regenerating copies: write the new copy, update the row, then delete the old object. A failed delete is logged, never thrown.
- No new npm dependencies.

## Review Focus

1. Pango markup: `&`, `<` and `>` in the brand or in photographer names must be escaped, or the render fails. Test with `Tom & Jerry <Studio>`.
2. Images smaller than 1200px must not be enlarged. Test with an 800×600 source.
3. Saving gallery details without changing the name must not regenerate copies. Test with the PUT handler's decision function.
4. Turning preview on for a gallery with 0 images must succeed. Test with `ensureWatermarks` on an empty list.
5. A photo uploaded while preview is on gets its copy before its row exists. The finalize route creates the copy before inserting, as Task 3 asserts by code order.

---

### Task 1: Database migration (the user runs it)

**Files:**
- Create: `supabase/migrations/20261110_preview_watermarks.sql`

**Interfaces:**
- Produces: `galleries.is_preview boolean`, `images.watermarked_url text`, and `public.get_gallery_photos(p_gallery_id uuid) returns table(id uuid, created_at timestamptz, display_url text, download_url text)`.

- [ ] **Step 1:** Write the SQL:
  - a commented `select policyname, cmd from pg_policies where tablename = 'images';` to run first;
  - the two `add column if not exists` statements;
  - `drop policy if exists` for the public SELECT policy, with its name filled in from step 1's output;
  - owner-only SELECT and UPDATE policies that check `exists (select 1 from galleries g where g.id = images.gallery_id and g.owner_id = auth.uid())`;
  - the `security definer` function with `set search_path = public`, which leaves out preview rows whose `watermarked_url is null`;
  - `grant execute ... to anon, authenticated`.
- [ ] **Step 2:** Hand the SQL to the user and wait for them to confirm it ran.
- [ ] **Step 3: Verify** with the anon key: `select('watermarked_url').limit(1)` on images errors or returns `[]` (row-level security), and `rpc('get_gallery_photos', {p_gallery_id: <existing id>})` returns rows with `display_url`.
- [ ] **Step 4:** Commit.

### Task 2: Watermark rendering

**Files:**
- Create: `server/watermark.js`, `server/fonts/Inter-Medium.ttf` (OFL, from the Google Fonts release), `server/watermark.test.js`

**Interfaces:**
- Produces: `renderWatermark(sourceBuffer: Buffer, photographerName: string) => Promise<Buffer>` (JPEG) and `watermarkText(name: string) => string`, which builds the Pango-escaped text.

- [ ] **Step 1: Write failing tests** in `server/watermark.test.js`. These are plain `node:assert` checks run by `node server/watermark.test.js`:
  - `watermarkText('Tom & Jerry <Studio>')` contains `Tom &amp; Jerry &lt;Studio&gt;` and `Bean &amp; Grain`.
  - From a 3000×2000 solid grey source, the output's metadata `format === 'jpeg'` and `Math.max(width, height) === 1200`.
  - From an 800×600 source, the output is 800×600 (not enlarged).
  - The output's pixel stats differ from a plain resized grey image (mean channel value is higher, because of the white overlay).
  - Rendering with the name `Tom & Jerry <Studio>` doesn't throw.
- [ ] **Step 2:** Run `node server/watermark.test.js` and expect it to FAIL with a module-not-found error.
- [ ] **Step 3: Implement.**
  - Resize with `.rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })`.
  - Build the tile with `sharp({ text: { text: '<span foreground="white">…</span>', fontfile, font: 'Inter Medium', dpi, rgba: true } })`. Scale the dpi so the text height is about 3.2% of the long edge.
  - Pad the tile for spacing, `.rotate(-30, { background: transparent })`, then reduce alpha to about 35% with `.ensureAlpha(0.35)`, or by compositing with `dest-in`.
  - Composite onto the resized image with `{ input: tile, tile: true }`, then `.jpeg({ quality: 82 })`.
- [ ] **Step 4:** Run `node server/watermark.test.js` and expect it to PASS. Also write a sample to the scratchpad and look at it.
- [ ] **Step 5:** Commit.

### Task 3: Copies on upload, delete and regenerate

**Files:**
- Modify: `server/watermark.js` (add the R2 helpers)
- Modify: `server/index.js` (the finalize route, the image delete route)
- Modify: `vercel.json` (`functions["api/index.js"].includeFiles = "server/fonts/**"`)

**Interfaces:**
- Consumes: `renderWatermark` from Task 2.
- Produces:
  - `createWatermarkedCopy({ galleryId, sourceKey, photographerName }) => Promise<string>`, which returns the public URL.
  - `ensureWatermarks(supabase, gallery: { id, photographer_name }, { regenerate = false } = {}) => Promise<number>`, which returns the count of copies created.

- [ ] **Step 1: Add a test** to `server/watermark.test.js`. Call `ensureWatermarks` with a stub `supabase` whose images select resolves to `{ data: [], error: null }`, and assert that it resolves to `0`.
- [ ] **Step 2:** Run it and expect a FAIL, because the export is missing.
- [ ] **Step 3: Implement both helpers in `server/watermark.js`.** It imports `s3Client`, and the public base URL logic moves from `index.js` into a `publicUrl(key)` export that the finalize route reuses. `ensureWatermarks` goes through images one at a time. For each, it creates the new copy, runs `update({ watermarked_url })`, and then, only when regenerating and an old key exists, does `DeleteObjectCommand(old).catch(log)`. Mark the loop with a `// ponytail:` comment about sequential processing.
- [ ] **Step 4: Change the finalize route.** After the preview upload, `await createWatermarkedCopy({ galleryId, sourceKey: previewKey, photographerName })`. The photographer name is fetched with the existing ownership query, which now selects `owner_id, photographer_name`. Include `watermarked_url` in the insert. If anything fails after the original exists, delete the original, the preview and the watermark object (best effort), then return 500.
- [ ] **Step 5:** Change the image delete route to add `r2KeyFromUrl(image.watermarked_url)` to `objectsToDelete`.
- [ ] **Step 6:** Run `node server/watermark.test.js` (PASS) and `node --check server/index.js`, then commit.

### Task 4: Gallery API (toggle, rename, public reads)

**Files:**
- Modify: `server/index.js` (`GET /api/galleries/:id`, `PUT /api/galleries/:id`, `GET /api/galleries/:id/images`)

**Interfaces:**
- Consumes: `ensureWatermarks` from Task 3 and `get_gallery_photos` from Task 1.
- Produces:
  - GET gallery includes `is_preview`.
  - GET images returns full rows for the owner and `{ id, created_at, display_url, download_url }[]` for everyone else.
  - PUT accepts `{ title, photographer_name, is_preview }`.

- [ ] **Step 1: Add a test** for the pure function `watermarkAction(before, after) => 'regenerate' | 'fill' | 'none'`, exported from `server/watermark.js`. It returns `regenerate` when the name changed, `fill` when `is_preview` goes from false to true, and `none` otherwise. This includes the case where the title changed but not the name.
- [ ] **Step 2:** Run it and expect a FAIL. Implement it, run it again and expect a PASS.
- [ ] **Step 3: Update the PUT handler.**
  - Select `owner_id, photographer_name, is_preview`.
  - Compute the action.
  - Run `ensureWatermarks` **before** the update, using the new name. For `regenerate`, pass `{ regenerate: true }`.
  - Then update all three fields.
- [ ] **Step 4: Update GET images.** If an `access_token` cookie resolves to a user who owns the gallery, select `*`. Otherwise call `supabase.rpc('get_gallery_photos', { p_gallery_id })`.
- [ ] **Step 5:** Run `node --check`. Then, with the anon key and no cookie, call `GET /api/galleries/<id>/images` on a local server and assert that no response URL contains `_original.` or `_preview.` while the gallery is preview. Commit.

### Task 5: Frontend

**Files:**
- Modify: `src/pages/GalleryEdit.jsx`, `src/pages/Dashboard.jsx`, `src/pages/GalleryView.jsx`

**Interfaces:**
- Consumes: the Task 4 response shapes.

- [ ] **Step 1: GalleryEdit.**
  - Add `is_preview` to the `gallery` state and send it in the PUT.
  - Add a checkbox switch labelled "Preview mode" with the help text "Watermark photos and limit client downloads to 1200px previews".
  - While saving, the button says "Applying watermarks…" if preview is on or the name changed, and "Saving…" otherwise.
  - Show a "Preview on" tag next to the `h1` when `gallery.is_preview` is true.
- [ ] **Step 2: Dashboard.** Show a `Preview` tag (`eyebrow` style, bean colour) on cards where `gallery.is_preview` is true.
- [ ] **Step 3: GalleryView.**
  - The grid and lightbox use `img.display_url`, and downloads use `img.download_url`.
  - Under the photo count, when `gallery.is_preview` is true, show `Preview · Photos are watermarked`.
  - Downloaded file extensions come from the `download_url`.
- [ ] **Step 4:** `npx vite build` passes. Take CDP screenshots (the scratchpad `shoot.mjs`) of a preview gallery at 1440 and 390 widths and check that the watermark is visible and nothing overflows. Commit.

### Task 6: End-to-end check and deploy check

- [ ] **Step 1:** Run the security check with the anon key:
  - a direct `images` select returns `[]`;
  - the RPC for a preview gallery contains no `_original.` or `_preview.`;
  - for a final gallery, the URLs contain `_preview.` and `_original.`.
- [ ] **Step 2: Hand off to the user for the manual checks:**
  - toggle preview on, then use both download buttons and confirm the files are watermarked and 1200px;
  - rename the photographer and confirm the new name appears and the old `w/` objects are gone (list the prefix in R2);
  - toggle preview off and confirm the clean files are back.
- [ ] **Step 3:** After the Vercel preview deploy, upload one photo and open its `watermarked_url`. Confirm the text renders as glyphs.
