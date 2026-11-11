// Plain assert checks for the watermark module. Run: node server/watermark.test.js
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { watermarkText, renderWatermark } from './watermark.js';

const grey = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg().toBuffer();

const meanBrightness = async (buf) => {
  const { channels } = await sharp(buf).stats();
  return channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
};

const tests = {
  'watermarkText escapes Pango markup in brand and name': () => {
    const text = watermarkText('Tom & Jerry <Studio>');
    assert.ok(text.includes('Tom &amp; Jerry &lt;Studio&gt;'), text);
    assert.ok(text.includes('Bean &amp; Grain'), text);
    assert.ok(text.includes('Photography by'), text);
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
    assert.ok(after > before + 2, `expected brighter output, got ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  },

  'tiny image still gets watermarked at its own size': async () => {
    const out = await renderWatermark(await grey(120, 90), 'A Photographer With A Long Studio Name');
    const { width, height } = await sharp(out).metadata();
    assert.deepEqual([width, height], [120, 90]);
  },

  'names with markup characters render without throwing': async () => {
    await renderWatermark(await grey(1600, 1000), 'Tom & Jerry <Studio>');
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
