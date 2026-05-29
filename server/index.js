import express from 'express';
import cookieParser from 'cookie-parser';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

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
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

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
        console.warn(`Rejected file with mime: ${fileType?.mime}`);
        continue; // Skip invalid files
      }

      const fileId = uuidv4();
      const ext = fileType.ext;
      const originalPath = `${req.params.id}/${fileId}_original.${ext}`;
      const previewPath = `${req.params.id}/${fileId}_preview.${ext}`;

      // Upload original
      const { error: uploadError } = await supabase.storage
        .from('galleries')
        .upload(originalPath, file.buffer, {
          contentType: fileType.mime,
        });

      if (uploadError) throw uploadError;

      // Generate and upload preview using sharp
      const previewBuffer = await sharp(file.buffer)
        .rotate() // Auto-orient based on EXIF data before stripping metadata
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const { error: previewUploadError } = await supabase.storage
        .from('galleries')
        .upload(previewPath, previewBuffer, {
          contentType: 'image/jpeg',
        });

      if (previewUploadError) throw previewUploadError;

      // Get public URLs
      const { data: { publicUrl: imageUrl } } = supabase.storage.from('galleries').getPublicUrl(originalPath);
      const { data: { publicUrl: previewUrl } } = supabase.storage.from('galleries').getPublicUrl(previewPath);

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

      if (dbError) throw dbError;
      uploadedImages.push(insertedImage);

    } catch (err) {
      console.error('Error processing file:', err);
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

  // Delete from storage
  // Extract paths from URLs (assuming standard format: .../storage/v1/object/public/galleries/path)
  const getPathFromUrl = (url) => {
    if (!url) return null;
    const parts = url.split('/galleries/');
    return parts.length > 1 ? parts[1] : null;
  };

  const originalPath = getPathFromUrl(image.image_url);
  const previewPath = getPathFromUrl(image.preview_url);

  const pathsToDelete = [originalPath, previewPath].filter(Boolean);

  supabase.storage.from('galleries').remove(pathsToDelete);

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
