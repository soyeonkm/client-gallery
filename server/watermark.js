import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Bundled font: Vercel's servers have no system fonts, so text must not rely on them
const FONT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts', 'Inter-Medium.ttf');

const MAX_EDGE = 1200;
const OPACITY = 0.4;
const ANGLE = -30;

// Pango markup: brand and names must be escaped (e.g. "&" breaks the renderer otherwise)
const escapeMarkup = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const watermarkText = (name) => `${escapeMarkup('Bean & Grain')}  ·  Photography by ${escapeMarkup(name)}`;

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
  const { data: cell, info: cellInfo } = await sharp(text)
    .extend({ top: fontSize * 2, bottom: fontSize * 2, left: fontSize * 2, right: fontSize * 2, background: transparent })
    .png()
    .toBuffer({ resolveWithObject: true });

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
