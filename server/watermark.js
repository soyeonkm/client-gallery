import './fontconfig.js'; // first: before sharp renders any text
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import s3Client from './r2Config.js';

// Bundled font: Vercel's servers have no system fonts, so text must not rely on them
// Same faces as the Bean & Grain wordmark: SemiBold words, Medium Italic ampersand
const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
export const WATERMARK_FONTS = {
  semibold: { file: path.join(FONT_DIR, 'CormorantGaramond-SemiBold.ttf'), font: 'Cormorant Garamond SemiBold' },
  italic: { file: path.join(FONT_DIR, 'CormorantGaramond-MediumItalic.ttf'), font: 'Cormorant Garamond Medium Italic' },
};

const MAX_EDGE = 1200;
const OPACITY = 0.6;
const ANGLE = -30;

// Pango markup: brand and names must be escaped (e.g. "&" breaks the renderer otherwise)
const escapeMarkup = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// sharp loads one font file per text render, so the phrase is rendered as pieces and joined
export const watermarkSegments = (name) => [
  { face: 'semibold', text: 'Bean' },
  { face: 'italic', text: escapeMarkup('&') },
  { face: 'semibold', text: `Grain  ·  Photography by ${escapeMarkup(name)}` },
];

// Renders the phrase as one transparent image: pieces side by side, separated by a word space
const renderPhrase = async (name, fontSize) => {
  const pieces = await Promise.all(
    watermarkSegments(name).map(({ face, text }) =>
      sharp({
        text: {
          text: `<span foreground="white">${text}</span>`,
          font: `${WATERMARK_FONTS[face].font} ${fontSize}`,
          fontfile: WATERMARK_FONTS[face].file,
          dpi: 72,
          rgba: true,
        },
      }).png().toBuffer({ resolveWithObject: true })
    )
  );
  const gap = Math.round(fontSize * 0.28);
  const width = pieces.reduce((sum, p) => sum + p.info.width, 0) + gap * (pieces.length - 1);
  const height = Math.max(...pieces.map((p) => p.info.height));
  let left = 0;
  const layers = pieces.map((p) => {
    const layer = { input: p.data, left, top: 0 };
    left += p.info.width + gap;
    return layer;
  });
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
};

// Two-row repeat unit: the second row is the first shifted right by half its width (wrapping),
// so rows of text are staggered like brickwork instead of lining up in columns
export const staggerRows = async (cell) => {
  const { width, height } = await sharp(cell).metadata();
  const half = Math.floor(width / 2);
  const [leftPart, rightPart] = await Promise.all([
    sharp(cell).extract({ left: 0, top: 0, width: width - half, height }).png().toBuffer(),
    sharp(cell).extract({ left: width - half, top: 0, width: half, height }).png().toBuffer(),
  ]);
  return sharp({ create: { width, height: height * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: cell, left: 0, top: 0 },
      { input: leftPart, left: half, top: height },
      { input: rightPart, left: 0, top: height },
    ])
    .png()
    .toBuffer();
};

// Text pattern for a width x height photo: evenly spaced rows of text on an oversized canvas,
// rotated as a whole and cropped to the photo, so the diagonal rows are dense and uniform
const renderOverlay = async (width, height, name) => {
  const longEdge = Math.max(width, height);
  const fontSize = Math.max(10, Math.round(longEdge * 0.04));
  const text = await renderPhrase(name, fontSize);

  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const padded = await sharp(text)
    .extend({ top: Math.round(fontSize * 1.1), bottom: Math.round(fontSize * 1.1), left: Math.round(fontSize * 1.5), right: Math.round(fontSize * 1.5), background: transparent })
    .png()
    .toBuffer();
  const cell = await staggerRows(padded);
  const cellInfo = await sharp(cell).metadata();

  // Square canvas covering the photo at any rotation (and at least one text cell, which sharp needs to tile)
  const side = Math.max(Math.ceil(Math.hypot(width, height)), cellInfo.width, cellInfo.height);
  const rows = await sharp({ create: { width: side, height: side, channels: 4, background: transparent } })
    .composite([{ input: cell, tile: true }])
    .png()
    .toBuffer();

  const rotated = await sharp(rows).rotate(ANGLE, { background: transparent }).png().toBuffer({ resolveWithObject: true });
  return sharp(rotated.data)
    .extract({
      left: Math.floor((rotated.info.width - width) / 2),
      top: Math.floor((rotated.info.height - height) / 2),
      width,
      height,
    })
    .linear([1, 1, 1, OPACITY], [0, 0, 0, 0]) // scale only the alpha channel
    .png()
    .toBuffer();
};

export const renderWatermark = async (sourceBuffer, photographerName) => {
  const { data: base, info } = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const overlay = await renderOverlay(info.width, info.height, photographerName);

  return sharp(base)
    .composite([{ input: overlay, blend: 'over' }])
    .jpeg({ quality: 82 })
    .toBuffer();
};

// Style version: a hash of everything that decides how a watermark looks (drawing code, settings, fonts).
// Any change to the look changes it, which marks every existing copy as outdated (see needsWatermark).
export const WATERMARK_STYLE_VERSION = createHash('sha256')
  .update(JSON.stringify([MAX_EDGE, OPACITY, ANGLE]))
  .update([escapeMarkup, watermarkSegments, renderPhrase, staggerRows, renderOverlay, renderWatermark].map(String).join('\n'))
  .update(readFileSync(WATERMARK_FONTS.semibold.file))
  .update(readFileSync(WATERMARK_FONTS.italic.file))
  .update(readFileSync(path.join(FONT_DIR, 'fonts.conf')))
  .digest('hex')
  .slice(0, 12);

// Folder for copies of one style and one photographer name: "<style version>-<name hash>".
// Both are baked into the image, so a copy is current only if both match. Because each finished copy
// already sits in the new folder, an interrupted rename resumes where it stopped instead of starting over.
export const watermarkFolder = (photographerName) =>
  `${WATERMARK_STYLE_VERSION}-${createHash('sha256').update(String(photographerName ?? '')).digest('hex').slice(0, 8)}`;

// New copies get a UUID unrelated to the photo's other keys
export const watermarkKey = (galleryId, photographerName) =>
  `${galleryId}/w/${watermarkFolder(photographerName)}/${uuidv4()}.jpg`;

// A photo needs a (new) copy when it has none, or its copy has another style or another name
export const needsWatermark = (image, photographerName) =>
  !image.watermarked_url || !image.watermarked_url.includes(`/w/${watermarkFolder(photographerName)}/`);

// Public URL for an R2 key, via the configured public bucket domain
export const publicUrl = (key) => {
  let base = process.env.R2_PUBLIC_URL.replace(/[\s\n\r]/g, '').replace(/\/$/, '');
  if (!base.startsWith('http')) base = `https://${base}`;
  return `${base}/${key}`;
};

// R2 object key from its public URL (pathname minus leading slash)
export const r2KeyFromUrl = (url) => {
  try {
    return new URL(url).pathname.substring(1);
  } catch {
    return null;
  }
};

// Reads sourceKey (the clean preview) from R2 and stores a watermarked copy under an unrelated random key
export const createWatermarkedCopy = async ({ galleryId, sourceKey, photographerName }) => {
  const Bucket = process.env.R2_BUCKET_NAME;
  const source = await s3Client.send(new GetObjectCommand({ Bucket, Key: sourceKey }));
  const body = await renderWatermark(Buffer.from(await source.Body.transformToByteArray()), photographerName);
  const key = watermarkKey(galleryId, photographerName);
  await s3Client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: 'image/jpeg' }));
  return publicUrl(key);
};

// Creates copies that are missing or outdated (another style, or a name change).
// Order per photo: write new copy, point the row at it, then delete the old copy. Finished photos already
// count as current, so a run cut short (e.g. by the function time limit) picks up where it stopped.
// Photos whose source files no longer exist in R2 are skipped and reported in `missing`; they have nothing
// to watermark and never appear in preview mode (get_gallery_photos leaves out rows without a copy).
// onProgress(done, total) is called once before starting and after each photo that needed work.
export const ensureWatermarks = async (
  supabase,
  gallery,
  { createCopy = createWatermarkedCopy, onProgress = () => {} } = {}
) => {
  const { data: images, error } = await supabase
    .from('images')
    .select('id, image_url, preview_url, watermarked_url')
    .eq('gallery_id', gallery.id);
  if (error) throw error;

  const todo = images.filter((image) => needsWatermark(image, gallery.photographer_name));
  let created = 0;
  const missing = [];
  onProgress(0, todo.length);
  // ponytail: one photo at a time (~0.3s each) fits Vercel's 300s limit up to a few hundred photos; use a queue beyond that
  for (const [index, image] of todo.entries()) {
    let watermarkedUrl;
    try {
      watermarkedUrl = await createCopy({
        galleryId: gallery.id,
        sourceKey: r2KeyFromUrl(image.preview_url || image.image_url),
        photographerName: gallery.photographer_name,
      });
    } catch (err) {
      if (err.name !== 'NoSuchKey') throw err;
      console.warn(`Skipping watermark for image ${image.id}: its source file is missing from storage`);
      missing.push(image.id);
      onProgress(index + 1, todo.length);
      continue;
    }

    const { data: updated, error: updateError } = await supabase
      .from('images')
      .update({ watermarked_url: watermarkedUrl })
      .eq('id', image.id)
      .select('id');
    if (updateError) throw updateError;
    if (!updated?.length) throw new Error(`Could not save watermark for image ${image.id} (check images UPDATE policy)`);
    created++;

    const oldKey = image.watermarked_url && r2KeyFromUrl(image.watermarked_url);
    if (oldKey) {
      await s3Client
        .send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: oldKey }))
        .catch((err) => console.error(`Failed to delete old watermark ${oldKey}:`, err));
    }
    onProgress(index + 1, todo.length);
  }
  return { created, missing };
};

// What saving gallery details must do to the watermarked copies:
// the name is baked into every copy, so a rename regenerates; turning preview on fills in any missing copies.
export const watermarkAction = (before, after) => {
  if (after.photographer_name !== before.photographer_name) return 'regenerate';
  if (after.is_preview && !before.is_preview) return 'fill';
  return 'none';
};

// Supabase returns at most 1000 rows per request; page(from, to) runs one ranged query
export const fetchAllRows = async (page, pageSize = 1000) => {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
};

// Watermark files no row points to, except ones written in the last hour: a live upload or save
// writes its copy before linking it to a row, and must not lose it to a concurrent cleanup
export const unusedWatermarkKeys = (objects, referencedKeys, now = Date.now(), minAgeMs = 3600e3) =>
  objects
    .filter(({ Key, LastModified }) =>
      /^[^/]+\/w\//.test(Key) && !referencedKeys.has(Key) && now - new Date(LastModified).getTime() > minAgeMs)
    .map(({ Key }) => Key);
