import express from 'express';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import cookieParser from 'cookie-parser';
import { createClient } from '@supabase/supabase-js';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import s3Client from './r2Config.js';
import { PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { publicUrl, r2KeyFromUrl, createWatermarkedCopy } from './watermark.js';

const app = express();
const port = 3000;

app.use(express.json());
app.use(cookieParser());

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables.');
  process.exit(1);
}

// Helper to create a request-scoped Supabase client that uses the cookie's access token
const getSupabaseClient = (req) => {
  const token = req.cookies.access_token;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
    },
    auth: {
      persistSession: false,
    }
  });
};

// Set secure HttpOnly cookies
const setCookies = (res, session) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: session.expires_in * 1000,
  };

  res.cookie('access_token', session.access_token, cookieOptions);
  res.cookie('refresh_token', session.refresh_token, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
};

// Clear cookies
const clearCookies = (res) => {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
};

// Middleware to verify user session
const requireAuth = async (req, res, next) => {
  const token = req.cookies.access_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = getSupabaseClient(req);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = user;
  next();
};

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// True if the logged-in user owns the gallery
const assertGalleryOwner = async (supabase, galleryId, userId) => {
  const { data: gallery, error } = await supabase
    .from('galleries')
    .select('owner_id')
    .eq('id', galleryId)
    .single();
  return !error && gallery.owner_id === userId;
};

// Auth Routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) return res.status(400).json({ error: error.message });
  if (data.session) setCookies(res, data.session);

  res.json({ user: data.user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(400).json({ error: error.message });
  if (data.session) setCookies(res, data.session);

  res.json({ user: data.user });
});

app.post('/api/auth/update-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Missing token or password.' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/auth/logout', async (req, res) => {
  const supabase = getSupabaseClient(req);
  await supabase.auth.signOut();
  clearCookies(res);
  res.json({ success: true });
});

app.get('/api/auth/user', async (req, res) => {
  const token = req.cookies.access_token;
  if (!token) return res.json({ user: null });

  const supabase = getSupabaseClient(req);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    clearCookies(res);
    return res.json({ user: null });
  }

  res.json({ user });
});

// Gallery Routes

app.get('/api/galleries', requireAuth, async (req, res) => {
  const supabase = getSupabaseClient(req);
  const { data, error } = await supabase
    .from('galleries')
    .select('*')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/galleries/:id', async (req, res) => {
  const supabase = getSupabaseClient(req);
  const { data, error } = await supabase
    .from('galleries')
    .select('id, title, photographer_name, created_at, owner_id')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Gallery not found' });
  res.json(data);
});

app.post('/api/galleries', requireAuth, async (req, res) => {
  const { title, photographer_name } = req.body;
  const supabase = getSupabaseClient(req);

  const { data, error } = await supabase
    .from('galleries')
    .insert([{ title, photographer_name, owner_id: req.user.id }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

// Update gallery settings
app.put('/api/galleries/:id', requireAuth, async (req, res) => {
  const { title, photographer_name } = req.body;
  const supabase = getSupabaseClient(req);

  // Verify ownership first
  const { data: gallery, error: fetchError } = await supabase
    .from('galleries')
    .select('owner_id')
    .eq('id', req.params.id)
    .single();

  if (fetchError || gallery.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data, error } = await supabase
    .from('galleries')
    .update({ title, photographer_name })
    .eq('id', req.params.id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/api/galleries/:id', requireAuth, async (req, res) => {
  const supabase = getSupabaseClient(req);
  const galleryId = req.params.id;

  const { data: gallery, error: fetchError } = await supabase
    .from('galleries')
    .select('owner_id')
    .eq('id', galleryId)
    .single();

  if (fetchError || gallery.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // DB first: if R2 cleanup fails afterwards we only leave invisible orphans, never a broken gallery
  const { error: imagesError } = await supabase.from('images').delete().eq('gallery_id', galleryId);
  if (imagesError) return res.status(500).json({ error: imagesError.message });

  const { data: deleted, error: galleryError } = await supabase
    .from('galleries')
    .delete()
    .eq('id', galleryId)
    .select('id');
  if (galleryError) return res.status(500).json({ error: galleryError.message });
  // RLS silently deletes 0 rows if there's no delete policy
  if (!deleted?.length) return res.status(500).json({ error: 'Gallery could not be deleted (check RLS delete policy).' });

  // Remove every object under the gallery prefix, 1000 per page (S3 limit for both calls)
  try {
    let ContinuationToken;
    do {
      const page = await s3Client.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: `${galleryId}/`,
        ContinuationToken,
      }));
      if (page.Contents?.length) {
        await s3Client.send(new DeleteObjectsCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Delete: { Objects: page.Contents.map(({ Key }) => ({ Key })) },
        }));
      }
      ContinuationToken = page.NextContinuationToken;
    } while (ContinuationToken);
  } catch (err) {
    console.error(`R2 cleanup failed for gallery ${galleryId}:`, err);
  }

  res.json({ success: true });
});

// Images Routes

app.get('/api/galleries/:id/images', async (req, res) => {
  const supabase = getSupabaseClient(req);
  const { data, error } = await supabase
    .from('images')
    .select('*')
    .eq('gallery_id', req.params.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Step 1 of upload: browser gets a presigned URL and PUTs the original straight to R2
// (Vercel Functions cap request bodies at 4.5MB, so files can't pass through the server)
app.post('/api/galleries/:id/upload-url', requireAuth, async (req, res) => {
  const { contentType, size } = req.body;
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return res.status(400).json({ error: 'Only JPEG, PNG and WebP images are allowed.' });
  if (!(size > 0 && size <= MAX_UPLOAD_BYTES)) return res.status(400).json({ error: 'File must be 50MB or smaller.' });

  const supabase = getSupabaseClient(req);
  if (!(await assertGalleryOwner(supabase, req.params.id, req.user.id))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const key = `${req.params.id}/${uuidv4()}_original.${ext}`;
  const url = await getSignedUrl(
    s3Client,
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType }),
    { expiresIn: 600 }
  );
  res.json({ url, key });
});

// Step 2 of upload: server validates the uploaded original, builds the preview, saves the DB row
app.post('/api/galleries/:id/images', requireAuth, async (req, res) => {
  const { key } = req.body;
  const galleryId = req.params.id;
  // Only keys this gallery's upload-url route could have issued
  const match = typeof key === 'string' && key.match(/^([^/]+)\/[0-9a-f-]{36}_original\.(jpg|png|webp)$/);
  if (!match || match[1] !== galleryId) return res.status(400).json({ error: 'Invalid upload key.' });

  const supabase = getSupabaseClient(req);
  // Ownership check; also need the name for the watermark
  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('owner_id, photographer_name')
    .eq('id', galleryId)
    .single();
  if (galleryError || gallery.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const Bucket = process.env.R2_BUCKET_NAME;
  // Every object this request has put in R2, removed again if the upload can't be completed
  const written = [key];
  const cleanUp = () =>
    s3Client
      .send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: written.map((Key) => ({ Key })) } }))
      .catch((err) => console.error('Upload cleanup failed:', err));
  const rejectUpload = async (status, error) => {
    await cleanUp();
    return res.status(status).json({ error });
  };

  try {
    const object = await s3Client.send(new GetObjectCommand({ Bucket, Key: key }));
    if (object.ContentLength > MAX_UPLOAD_BYTES) return rejectUpload(400, 'File must be 50MB or smaller.');
    const buffer = Buffer.from(await object.Body.transformToByteArray());

    // Validate magic bytes against the type the key was issued for
    const fileType = await fileTypeFromBuffer(buffer);
    if (!fileType || ALLOWED_TYPES[fileType.mime] !== match[2]) {
      console.warn(`Upload rejected: unsupported type ${fileType?.mime || 'unknown'}`);
      return rejectUpload(400, 'File is not a valid JPEG, PNG or WebP image.');
    }

    // Generate and upload preview using sharp, ensuring it's under 1MB
    let previewBuffer = await sharp(buffer).rotate().toBuffer();
    let quality = 100;
    while (previewBuffer.length > 1024 * 1024 && quality >= 20) {
      quality -= 10;
      previewBuffer = await sharp(buffer).rotate().jpeg({ quality }).toBuffer();
    }

    const previewKey = key.replace('_original.', '_preview.');
    await s3Client.send(new PutObjectCommand({
      Bucket,
      Key: previewKey,
      Body: previewBuffer,
      ContentType: 'image/jpeg',
    }));
    written.push(previewKey);

    // Every photo gets its watermarked copy before its row exists, so preview mode never lacks one
    const watermarkedUrl = await createWatermarkedCopy({
      galleryId,
      sourceKey: previewKey,
      photographerName: gallery.photographer_name,
    });
    written.push(r2KeyFromUrl(watermarkedUrl));

    const { data: insertedImage, error: dbError } = await supabase
      .from('images')
      .insert([{
        gallery_id: galleryId,
        image_url: publicUrl(key),
        preview_url: publicUrl(previewKey),
        watermarked_url: watermarkedUrl,
      }])
      .select()
      .single();
    if (dbError) throw dbError;

    res.status(201).json(insertedImage);
  } catch (err) {
    console.error('Upload failed:', err);
    if (err.name === 'NoSuchKey') return res.status(400).json({ error: 'Upload not found in storage.' });
    return rejectUpload(500, 'Failed to process upload.');
  }
});

app.delete('/api/images/:id', requireAuth, async (req, res) => {
  const supabase = getSupabaseClient(req);

  // Get image to find paths and verify ownership via gallery_id
  const { data: image, error: fetchError } = await supabase
    .from('images')
    .select('*, galleries(owner_id)')
    .eq('id', req.params.id)
    .single();

  if (fetchError || !image) {
    return res.status(404).json({ error: 'Image not found' });
  }

  if (image.galleries.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Delete from R2
  const objectsToDelete = [image.image_url, image.preview_url, image.watermarked_url]
    .map(r2KeyFromUrl)
    .filter(Boolean)
    .map(Key => ({ Key }));

  if (objectsToDelete.length > 0) {
    await s3Client.send(new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Delete: { Objects: objectsToDelete }
    }));
  }

  // Delete from DB
  const { error: deleteError } = await supabase
    .from('images')
    .delete()
    .eq('id', req.params.id);

  if (deleteError) return res.status(500).json({ error: deleteError.message });

  res.json({ success: true });
});

// On Vercel the app is served by api/index.js; locally it listens on its own port
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`BFF Server running on port ${port}`);
  });
}

export default app;
