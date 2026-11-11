import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import s3Client from './r2Config.js';

// Bundled font: Vercel's servers have no system fonts, so text must not rely on them
const FONT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts', 'Inter-Medium.ttf');

const MAX_EDGE = 1200;
const OPACITY = 0.4;
const ANGLE = -30;

// Pango markup: brand and names must be escaped (e.g. "&" breaks the renderer otherwise)
const escapeMarkup = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const watermarkText = (name) => `${escapeMarkup('Bean & Grain')}  ·  Photography by ${escapeMarkup(name)}`;

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
  const fontSize = Math.max(10, Math.round(longEdge * 0.026));
  const text = await sharp({
    text: {
      text: `<span foreground="white">${watermarkText(name)}</span>`,
      font: `Inter Medium ${fontSize}`,
      fontfile: FONT_FILE,
      dpi: 72,
      rgba: true,
    },
  }).png().toBuffer();

  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const padded = await sharp(text)
    .extend({ top: fontSize * 2, bottom: fontSize * 2, left: fontSize * 2, right: fontSize * 2, background: transparent })
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
  const key = `${galleryId}/w/${uuidv4()}.jpg`;
  await s3Client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: 'image/jpeg' }));
  return publicUrl(key);
};

// Creates missing watermarked copies for a gallery, or new copies for every photo when regenerate is set
// (e.g. after a name change). Order per photo: write new copy, point the row at it, then delete the old copy.
export const ensureWatermarks = async (supabase, gallery, { regenerate = false } = {}) => {
  const { data: images, error } = await supabase
    .from('images')
    .select('id, image_url, preview_url, watermarked_url')
    .eq('gallery_id', gallery.id);
  if (error) throw error;

  let created = 0;
  // ponytail: one photo at a time (~0.3s each) fits Vercel's 300s limit up to a few hundred photos; use a queue beyond that
  for (const image of images) {
    if (!regenerate && image.watermarked_url) continue;

    const watermarkedUrl = await createWatermarkedCopy({
      galleryId: gallery.id,
      sourceKey: r2KeyFromUrl(image.preview_url || image.image_url),
      photographerName: gallery.photographer_name,
    });

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
  }
  return created;
};

// What saving gallery details must do to the watermarked copies:
// the name is baked into every copy, so a rename regenerates; turning preview on fills in any missing copies.
export const watermarkAction = (before, after) => {
  if (after.photographer_name !== before.photographer_name) return 'regenerate';
  if (after.is_preview && !before.is_preview) return 'fill';
  return 'none';
};
