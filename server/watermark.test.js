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

  'new copies are stored under the current style version': async () => {
    const { WATERMARK_STYLE_VERSION, watermarkKey } = await import('./watermark.js');
    assert.match(WATERMARK_STYLE_VERSION, /^[0-9a-f]{12}$/);
    assert.match(watermarkKey('g1'), new RegExp(`^g1/w/${WATERMARK_STYLE_VERSION}/[0-9a-f-]{36}\\.jpg$`));
  },

  'copies from another style version (or none) count as outdated': async () => {
    const { WATERMARK_STYLE_VERSION: v, needsWatermark } = await import('./watermark.js');
    const at = (key) => ({ watermarked_url: `https://pub.example.r2.dev/${key}` });
    assert.equal(needsWatermark({ watermarked_url: null }), true, 'missing');
    assert.equal(needsWatermark(at(`g1/w/${v}/abc.jpg`)), false, 'current');
    assert.equal(needsWatermark(at('g1/w/0123456789ab/abc.jpg')), true, 'other version');
    assert.equal(needsWatermark(at('g1/w/abc.jpg')), true, 'legacy unversioned key');
    assert.equal(needsWatermark(at(`g1/w/${v}/abc.jpg`), { regenerate: true }), true, 'forced');
  },

  'ensureWatermarks on a gallery with no photos creates nothing': async () => {
    const { ensureWatermarks } = await import('./watermark.js');
    const emptyGallery = {
      from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    };
    const created = await ensureWatermarks(emptyGallery, { id: 'g1', photographer_name: 'Jane Doe' });
    assert.equal(created, 0);
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
