import express from 'express';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import cookieParser from 'cookie-parser';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import s3Client from './r2Config.js';
import { PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

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

// Configure Multer for file uploads (Memory Storage, 50MB limit to prevent DoS)
// R2 object key from its public URL (pathname minus leading slash)
const r2KeyFromUrl = (url) => {
  try {
    return new URL(url).pathname.substring(1);
  } catch {
    return null;
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

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

app.post('/api/galleries/:id/images', requireAuth, upload.array('images', 20), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const supabase = getSupabaseClient(req);

  // Verify ownership
  const { data: gallery, error: fetchError } = await supabase
    .from('galleries')
    .select('owner_id')
    .eq('id', req.params.id)
    .single();

  if (fetchError || gallery.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const uploadedImages = [];

  for (const file of files) {
    try {
      // Validate Magic Bytes
      const fileType = await fileTypeFromBuffer(file.buffer);

      if (!fileType || !['image/jpeg', 'image/png', 'image/webp'].includes(fileType.mime)) {
        console.warn(`Upload rejected: unsupported type ${fileType?.mime || 'unknown'}`);
        continue; // Skip invalid files
      }

      const fileId = uuidv4();
      const ext = fileType.ext;
      const originalPath = `${req.params.id}/${fileId}_original.${ext}`;
      const previewPath = `${req.params.id}/${fileId}_preview.${ext}`;

      // Upload original
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: originalPath,
        Body: file.buffer,
        ContentType: fileType.mime,
      }));

      // Generate and upload preview using sharp, ensuring it's under 1MB
      let previewBuffer = await sharp(file.buffer).rotate().toBuffer();
      let quality = 100;

      while (previewBuffer.length > 1024 * 1024 && quality >= 20) {
        quality -= 10;
        previewBuffer = await sharp(file.buffer)
          .rotate()
          .jpeg({ quality: quality })
          .toBuffer();
      }

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: previewPath,
        Body: previewBuffer,
        ContentType: 'image/jpeg',
      }));

      // Get public URLs using the configured R2 public dev domain
      let baseUrl = process.env.R2_PUBLIC_URL.replace(/[\s\n\r]/g, '').replace(/\/$/, '');
      if (!baseUrl.startsWith('http')) {
        baseUrl = `https://${baseUrl}`;
      }
      const imageUrl = `${baseUrl}/${originalPath}`;
      const previewUrl = `${baseUrl}/${previewPath}`;

      // Insert DB record
      const { data: insertedImage, error: dbError } = await supabase
        .from('images')
        .insert([{
          gallery_id: req.params.id,
          image_url: imageUrl,
          preview_url: previewUrl
        }])
        .select()
        .single();

      if (dbError) {
        throw dbError;
      }

      uploadedImages.push(insertedImage);

    } catch (err) {
      console.error('Upload failed:', err);
      // Continue to next file on individual failure
    }
  }

  res.status(201).json(uploadedImages);
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
  const objectsToDelete = [r2KeyFromUrl(image.image_url), r2KeyFromUrl(image.preview_url)]
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

app.listen(port, () => {
  console.log(`BFF Server running on port ${port}`);
});
