// Plain assert checks for the watermark module. Run: node server/watermark.test.js
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { watermarkSegments, renderWatermark } from './watermark.js';

const grey = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg().toBuffer();

const meanBrightness = async (buf) => {
  const { channels } = await sharp(buf).stats();
  return channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
};

const tests = {
  'watermark text matches the wordmark: semibold words, italic ampersand, escaped name': () => {
    const segments = watermarkSegments('Tom & Jerry <Studio>');
    assert.deepEqual(segments.map((s) => s.face), ['semibold', 'italic', 'semibold']);
    assert.equal(segments[0].text, 'Bean');
    assert.equal(segments[1].text, '&amp;');
    assert.ok(segments[2].text.startsWith('Grain'), segments[2].text);
    assert.ok(segments[2].text.includes('Photography by Tom &amp; Jerry &lt;Studio&gt;'), segments[2].text);
  },

  'large image is resized to a 1200px long edge JPEG': async () => {
    const out = await renderWatermark(await grey(3000, 2000), 'Jane Doe');
    const { format, width, height } = await sharp(out).metadata();
    assert.equal(format, 'jpeg');
    assert.equal(Math.max(width, height), 1200);
  },

  'small image is not enlarged': async () => {
    const out = await renderWatermark(await grey(800, 600), 'Jane Doe');
    const { width, height } = await sharp(out).metadata();
    assert.deepEqual([width, height], [800, 600]);
  },

  'white overlay actually changes the pixels': async () => {
    const plain = await sharp(await grey(3000, 2000)).resize(1200).jpeg().toBuffer();
    const marked = await renderWatermark(await grey(3000, 2000), 'Jane Doe');
    const [before, after] = [await meanBrightness(plain), await meanBrightness(marked)];
    assert.ok(after > before + 3.5, `watermark not prominent enough: ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  },

  'watermark uses the wordmark fonts: Cormorant Garamond SemiBold + Medium Italic': async () => {
    const { WATERMARK_FONTS } = await import('./watermark.js');
    const { existsSync } = await import('node:fs');
    assert.match(WATERMARK_FONTS.semibold.file, /CormorantGaramond-SemiBold\.ttf$/);
    assert.match(WATERMARK_FONTS.italic.file, /CormorantGaramond-MediumItalic\.ttf$/);
    for (const { file } of Object.values(WATERMARK_FONTS)) assert.ok(existsSync(file), `missing ${file}`);
  },

  'bundled Cormorant Garamond actually renders (not a fallback font)': async () => {
    const { WATERMARK_FONTS } = await import('./watermark.js');
    const { font, file } = WATERMARK_FONTS.semibold;
    const { width } = await sharp({ text: { text: 'Bean Grain Photography', font: `${font} 40`, fontfile: file, dpi: 72 } }).metadata();
    // Cormorant Garamond SemiBold sets this string at ~387px; fallback sans fonts come out at 435-464px
    assert.ok(Math.abs(width - 387) <= 12, `rendered ${width}px, expected ~387px: bundled font not used`);
  },

  'tiny image still gets watermarked at its own size': async () => {
    const out = await renderWatermark(await grey(120, 90), 'A Photographer With A Long Studio Name');
    const { width, height } = await sharp(out).metadata();
    assert.deepEqual([width, height], [120, 90]);
  },

  'every other row is offset by half the phrase length': async () => {
    const { staggerRows } = await import('./watermark.js');
    // 100x20 transparent cell with one opaque column at x=10
    const width = 100, height = 20;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) raw[(y * width + 10) * 4 + 3] = 255;
    const cell = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();

    const { data, info } = await sharp(await staggerRows(cell)).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height], [100, 40]);
    const opaqueColumns = (row) =>
      [...Array(width).keys()].filter((x) => data[(row * width + x) * info.channels + 3] > 0);
    assert.deepEqual(opaqueColumns(5), [10], 'first row unchanged');
    assert.deepEqual(opaqueColumns(25), [60], 'second row shifted by half (10 + 50)');
  },

  'names with markup characters render without throwing': async () => {
    await renderWatermark(await grey(1600, 1000), 'Tom & Jerry <Studio>');
  },

  'watermarkAction decides what a gallery save must do to the copies': async () => {
    const { watermarkAction } = await import('./watermark.js');
    const before = { title: 'A', photographer_name: 'Jane', is_preview: false };
    assert.equal(watermarkAction(before, { ...before, photographer_name: 'Jane Doe' }), 'regenerate');
    assert.equal(watermarkAction({ ...before, is_preview: true }, { ...before, is_preview: true, photographer_name: 'J' }), 'regenerate');
    assert.equal(watermarkAction(before, { ...before, is_preview: true }), 'fill');
    assert.equal(watermarkAction(before, { ...before, title: 'B' }), 'none');
    assert.equal(watermarkAction({ ...before, is_preview: true }, { ...before, is_preview: false }), 'none');
    assert.equal(watermarkAction({ ...before, is_preview: true }, { ...before, is_preview: true }), 'none');
  },

  'new copies are stored under the style version and the photographer name': async () => {
    const { watermarkFolder, watermarkKey } = await import('./watermark.js');
    assert.match(watermarkFolder('Jane'), /^[0-9a-f]{12}-[0-9a-f]{8}$/);
    assert.notEqual(watermarkFolder('Jane'), watermarkFolder('Jane Doe'), 'name is part of the folder');
    assert.match(watermarkKey('g1', 'Jane'), new RegExp(`^g1/w/${watermarkFolder('Jane')}/[0-9a-f-]{36}\\.jpg$`));
  },

  'copies with another style or another name (or none) count as outdated': async () => {
    const { WATERMARK_STYLE_VERSION: v, watermarkFolder, needsWatermark } = await import('./watermark.js');
    const at = (key) => ({ watermarked_url: `https://pub.example.r2.dev/${key}` });
    assert.equal(needsWatermark({ watermarked_url: null }, 'Jane'), true, 'missing');
    assert.equal(needsWatermark(at(`g1/w/${watermarkFolder('Jane')}/abc.jpg`), 'Jane'), false, 'current');
    assert.equal(needsWatermark(at(`g1/w/${watermarkFolder('Jane')}/abc.jpg`), 'Jane Doe'), true, 'renamed since');
    assert.equal(needsWatermark(at(`g1/w/0123456789ab-${watermarkFolder('Jane').slice(13)}/abc.jpg`), 'Jane'), true, 'other style');
    assert.equal(needsWatermark(at(`g1/w/${v}/abc.jpg`), 'Jane'), true, 'older key without name');
    assert.equal(needsWatermark(at('g1/w/abc.jpg'), 'Jane'), true, 'legacy unversioned key');
  },

  'a missing photographer name renders instead of throwing': () => {
    assert.ok(watermarkSegments(undefined)[2].text.endsWith('Photography by '));
    assert.ok(watermarkSegments(null)[2].text.endsWith('Photography by '));
  },

  'fetchAllRows reads past the 1000-row cap, page by page': async () => {
    const { fetchAllRows } = await import('./watermark.js');
    const total = 2003;
    const ranges = [];
    const page = async (from, to) => {
      ranges.push([from, to]);
      const rows = [];
      for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ i });
      return { data: rows, error: null };
    };
    const rows = await fetchAllRows(page);
    assert.equal(rows.length, total);
    assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  },

  'unusedWatermarkKeys spares referenced and freshly written files': async () => {
    const { unusedWatermarkKeys } = await import('./watermark.js');
    const now = Date.parse('2026-11-11T12:00:00Z');
    const old = new Date(now - 2 * 3600e3);
    const fresh = new Date(now - 10 * 60e3);
    const objects = [
      { Key: 'g1/w/v-n/used.jpg', LastModified: old },
      { Key: 'g1/w/v-n/orphan.jpg', LastModified: old },
      { Key: 'g1/w/v-n/just-written.jpg', LastModified: fresh },
      { Key: 'g1/abc_original.jpg', LastModified: old },
    ];
    assert.deepEqual(unusedWatermarkKeys(objects, new Set(['g1/w/v-n/used.jpg']), now), ['g1/w/v-n/orphan.jpg']);
  },

  'ensureWatermarks on a gallery with no photos creates nothing': async () => {
    const { ensureWatermarks } = await import('./watermark.js');
    const emptyGallery = {
      from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    };
    const result = await ensureWatermarks(emptyGallery, { id: 'g1', photographer_name: 'Jane Doe' });
    assert.deepEqual(result, { created: 0, missing: [] });
  },

  'ensureWatermarks skips photos whose files are gone and keeps going': async () => {
    const { ensureWatermarks } = await import('./watermark.js');
    const images = [
      { id: 'gone', preview_url: 'https://r2.example/g1/gone_preview.jpg', watermarked_url: null },
      { id: 'fine', preview_url: 'https://r2.example/g1/fine_preview.jpg', watermarked_url: null },
    ];
    const updated = [];
    const supabase = {
      from: () => ({
        select: () => ({ eq: async () => ({ data: images, error: null }) }),
        update: (row) => ({ eq: (_col, id) => ({ select: async () => { updated.push([id, row.watermarked_url]); return { data: [{ id }], error: null }; } }) }),
      }),
    };
    const createCopy = async ({ sourceKey }) => {
      if (sourceKey.includes('gone')) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
      return 'https://r2.example/g1/w/v/new.jpg';
    };
    const result = await ensureWatermarks(supabase, { id: 'g1', photographer_name: 'Jane' }, { createCopy });
    assert.deepEqual(result, { created: 1, missing: ['gone'] });
    assert.deepEqual(updated, [['fine', 'https://r2.example/g1/w/v/new.jpg']]);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(failed ? `${failed} failed` : `all ${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
