// Checks preview-mode data protection against the real database using only the public anon key.
// usage: node scripts/check-preview-security.mjs
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

// 1. Clean URLs are not readable straight from the images table
const { data: direct, error: directError } = await anon.from('images').select('image_url, preview_url, watermarked_url').limit(5);
assert.ok(directError || direct.length === 0, `anon can read images rows directly (${direct?.length} rows)`);

// 2. Every gallery's public photo list matches its mode
const { data: galleries, error: gErr } = await anon.from('galleries').select('id, is_preview');
assert.ifError(gErr);
for (const g of galleries) {
  const { data: photos, error } = await anon.rpc('get_gallery_photos', { p_gallery_id: g.id });
  assert.ifError(error);
  for (const p of photos) {
    assert.deepEqual(Object.keys(p).sort(), ['created_at', 'display_url', 'download_url', 'id']);
    if (g.is_preview) {
      assert.ok(!/_original\.|_preview\./.test(p.display_url + p.download_url), `clean URL leaked in preview gallery ${g.id}`);
    } else {
      assert.match(p.download_url, /_original\./, `final gallery ${g.id} should download originals`);
    }
  }
  console.log(`ok  gallery ${g.id} (${g.is_preview ? 'preview' : 'final'}): ${photos.length} photos`);
}
console.log('preview security checks passed');
