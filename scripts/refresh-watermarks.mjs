// Run after changing how watermarks look:
//   node scripts/refresh-watermarks.mjs --dry-run   # report only
//   node scripts/refresh-watermarks.mjs             # regenerate outdated copies, delete every unused watermark file
//
// Needs SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase → Project Settings → API → service_role).
// It bypasses row-level security, so it stays local: never add it to Vercel or a VITE_ variable.
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import s3Client from '../server/r2Config.js';
import { WATERMARK_STYLE_VERSION, ensureWatermarks, needsWatermark, r2KeyFromUrl } from '../server/watermark.js';

dotenv.config({ path: '.env.local', quiet: true });
const dryRun = process.argv.includes('--dry-run');
const Bucket = process.env.R2_BUCKET_NAME;

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase → Project Settings → API → service_role).');
  process.exit(1);
}
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

console.log(`Watermark style ${WATERMARK_STYLE_VERSION}${dryRun ? ' (dry run: nothing is changed)' : ''}\n`);

// 1. Regenerate outdated or missing copies, gallery by gallery (old copy deleted after each row is updated)
const galleries = must(await admin.from('galleries').select('id, title, photographer_name'));
for (const gallery of galleries) {
  const images = must(await admin.from('images').select('id, watermarked_url').eq('gallery_id', gallery.id));
  const outdated = images.filter((image) => needsWatermark(image)).length;
  const { missing } = outdated && !dryRun ? await ensureWatermarks(admin, gallery) : { missing: [] };
  console.log(`${outdated ? (dryRun ? 'would refresh' : 'refreshed') : 'up to date'}  ${outdated - missing.length}/${images.length}  ${gallery.title}`);
  if (missing.length) console.log(`   skipped ${missing.length} photo(s) whose files are missing from storage: ${missing.join(', ')}`);
}

// 2. Delete every watermark file no image row points to (older styles, failed uploads, removed photos)
const referenced = new Set(
  must(await admin.from('images').select('watermarked_url')).map((i) => r2KeyFromUrl(i.watermarked_url)).filter(Boolean)
);
const unused = [];
let ContinuationToken;
do {
  const page = await s3Client.send(new ListObjectsV2Command({ Bucket, ContinuationToken }));
  for (const { Key } of page.Contents ?? []) {
    if (/^[^/]+\/w\//.test(Key) && !referenced.has(Key)) unused.push(Key);
  }
  ContinuationToken = page.NextContinuationToken;
} while (ContinuationToken);

if (!dryRun) {
  for (let i = 0; i < unused.length; i += 1000) {
    const batch = unused.slice(i, i + 1000).map((Key) => ({ Key }));
    await s3Client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: batch } }));
  }
}
console.log(`\n${dryRun ? 'Would delete' : 'Deleted'} ${unused.length} unused watermark file(s).`);
