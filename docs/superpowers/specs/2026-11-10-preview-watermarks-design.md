# Preview Galleries with Watermarks — Design

Date: 2026-11-10
Status: Approved in conversation; awaiting written-spec review

## Goal

Let a photographer mark a gallery as a **preview**. While a gallery is in preview mode, clients only ever see and download watermarked, reduced-size copies of the photos, so the photos can't be taken and used without paying for the final delivery. The photographer can switch preview mode on and off at any time on the same gallery link.

## Decisions (from the brainstorming conversation)

| Topic | Decision |
|---|---|
| Lifecycle | A toggle on the same gallery, which can be turned on or off at any time. The client link doesn't change. |
| Watermarked size | Long edge 1200px, JPEG. Used for both viewing and downloading in preview mode. |
| Watermark text | `Bean & Grain · Photography by [photographer name]`, repeated diagonally. White, about 35% opacity. Identical styling across every photo. |
| Approach | **A.** A watermarked copy is generated for every photo at upload time, so the toggle is instant. |
| Name change | Regenerate the gallery's watermarked copies under new keys, then delete the old copies. |

## Data model

Migration `supabase/migrations/20261110_preview_watermarks.sql`, run once in the Supabase SQL editor:

- `galleries.is_preview boolean not null default false`
- `images.watermarked_url text null`
- Row-level security on `images`:
  - Replace the public SELECT with **owner-only** SELECT (the owner is found through `galleries.owner_id = auth.uid()`). The existing policy names aren't in the repo, so the migration starts with a `pg_policies` query to list them, and the drop uses the real name.
  - Add an **owner-only UPDATE** policy. Nothing updated `images` before, but regenerating watermarks updates `watermarked_url`.
  - INSERT and DELETE policies keep their current owner checks.
- Function `public.get_gallery_photos(p_gallery_id uuid)`:
  - Runs as `SECURITY DEFINER` with `search_path` pinned, and is executable by `anon` and `authenticated`.
  - Returns rows of `(id uuid, created_at timestamptz, display_url text, download_url text)` and nothing else.
  - **Preview gallery:** `display_url = download_url = watermarked_url`. Photos with no watermarked copy yet are left out rather than falling back to a clean URL.
  - **Final gallery:** `display_url = coalesce(preview_url, image_url)` and `download_url = image_url`.
  - Ordered by `created_at desc`.

`galleries` stays publicly readable, because title, photographer name and `is_preview` are not sensitive.

## Watermark generation (server)

New module `server/watermark.js`:

- **`renderWatermark(sourceBuffer, photographerName) → Promise<Buffer>`**
  1. Resize the image so its long edge is at most 1200px, applying EXIF rotation.
  2. Render the text tile with sharp's `text` input, using the bundled font file `server/fonts/Inter-Medium.ttf` (OFL licence). It must not rely on system fonts, because Vercel's servers have none.
  3. Rotate the tile -30°, make it white at about 35% alpha, and composite it over the photo with `tile: true`.
  4. Output a JPEG at quality 82.
  - The text size scales with the image, so the pattern looks the same on every photo.
- **`createWatermarkedCopy(galleryId, sourceKey, photographerName) → Promise<string url>`**
  - Reads the source from R2, calls `renderWatermark`, and writes to `<galleryId>/w/<new uuid>.jpg`.
  - The new key shares no UUID with the original or preview keys.
  - The source is the clean **preview** object (at most 1MB), never the original, which keeps it fast.
- **`ensureWatermarks(supabase, gallery, { regenerate })`**
  - Processes the gallery's images one at a time.
  - Without `regenerate`, it only creates copies for images that have no `watermarked_url`.
  - With `regenerate`, it creates a new copy for every image, updates that image's `watermarked_url`, **then** deletes the old object. If a delete fails, it's logged and ignored, leaving an orphaned file but never a broken row.
  - `// ponytail:` sequential processing takes roughly 0.3s per photo, fine up to a few hundred photos within Vercel's 300s limit. Move to a queue if galleries get bigger.

Vercel bundling: `vercel.json` adds `functions["api/index.js"].includeFiles = "server/fonts/**"` so the font ships with the function.

## API changes (`server/index.js`)

- **`POST /api/galleries/:id/images`** (finalize upload): after the preview is uploaded, also calls `createWatermarkedCopy` and stores `watermarked_url`. If watermarking fails, the upload request fails, the uploaded objects are cleaned up, and no row is saved. That way every saved photo always has a copy.
- **`PUT /api/galleries/:id`**:
  - Accepts `is_preview` alongside `title` and `photographer_name`.
  - If `photographer_name` changed: `ensureWatermarks(..., { regenerate: true })`.
  - Otherwise, if `is_preview` is being turned on: `ensureWatermarks(...)` for any missing copies.
  - The flag is saved **after** the copies exist, so a preview gallery never shows clean photos while copies are still being made.
- **`GET /api/galleries/:id`**: also returns `is_preview`.
- **`GET /api/galleries/:id/images`**:
  - **Logged-in owner:** returns the full rows, as today. Row-level security allows this.
  - **Anyone else:** returns `rpc('get_gallery_photos')`.
- **`DELETE /api/images/:id`**: also deletes the `watermarked_url` object.
- **`DELETE /api/galleries/:id`**: unchanged. The prefix delete already covers `<galleryId>/w/`.

## Frontend

- **GalleryEdit, Details card:**
  - A "Preview mode" switch with the help text "Watermark photos and limit client downloads to 1200px previews". It's saved with "Save changes".
  - Saving shows "Applying watermarks…" while it runs.
  - A "Preview on" label appears next to the title when the mode is on.
- **GalleryEdit, image grid:** unchanged. The owner sees clean previews.
- **Dashboard:** a "Preview" tag on cards where `is_preview` is true.
- **GalleryView (client page):**
  - Uses `display_url` for the grid and lightbox and `download_url` for single and zip downloads.
  - In preview mode it shows the line "Preview · Photos are watermarked" under the photo count.
  - The download code doesn't check the mode at all. It only ever has the URLs the server chose.

## Security notes and known limits

- In preview mode, clean URLs never reach a client. That applies to both the Express API and direct Supabase REST calls made with the public anon key, because row-level security blocks those.
- Watermarked keys use unrelated UUIDs, so they can't be used to guess clean keys.
- The R2 bucket stays public-read. Clean objects are protected by having unguessable keys that are never disclosed.
- **Limit:** clean links a client saw while the gallery was in final mode can't be taken back by switching to preview later.
- **Limit:** screenshots are always possible. The 1200px size and the watermark limit their value.

## Testing

1. **`server/watermark.test.js`**: an assert-based script with no framework, run with `node server/watermark.test.js`. It:
   - generates a 3000×2000 test image and watermarks it;
   - asserts the output is a JPEG with a long edge of 1200px;
   - asserts the pixels differ from an un-watermarked resize, showing the overlay was applied;
   - asserts the text tile isn't blank, showing the font rendered.
2. **Security check script**, using the anon key against the real database:
   - a direct `images` select returns 0 rows;
   - `get_gallery_photos` for a preview gallery contains no `_original` or `_preview` URLs;
   - for a final gallery it returns the clean URLs.
3. **Manual end-to-end check:**
   - turn preview on, then confirm the client page and both download buttons give watermarked 1200px files;
   - rename the photographer, then confirm the new name appears and the old `w/` objects are gone from R2;
   - turn preview off, then confirm the clean photos and originals come back.
4. **After the Vercel preview deploy:** confirm the watermark text renders as glyphs, not boxes.

## Out of scope

- Per-photo preview or final status, client favourites or selection, and payment-triggered release.
- Making the R2 bucket private with signed URLs. This is a possible later hardening step.
