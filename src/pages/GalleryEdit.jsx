import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppHeader, Spinner } from '../components/Brand';

const GalleryEdit = () => {
  const { galleryId } = useParams();
  const navigate = useNavigate();

  const [gallery, setGallery] = useState({ title: '', photographer_name: '', is_preview: false });
  // Last saved details: the preview tag and the save label reflect what's stored, not unsaved edits
  const [saved, setSaved] = useState(null);
  const [images, setImages] = useState([]);

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedImageIds, setSelectedImageIds] = useState(new Set());
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    fetchGalleryData();
  }, [galleryId]);

  const fetchGalleryData = async () => {
    try {
      const [galleryRes, imagesRes] = await Promise.all([
        fetch(`/api/galleries/${galleryId}`),
        fetch(`/api/galleries/${galleryId}/images?as=owner`)
      ]);

      if (!galleryRes.ok) throw new Error('Failed to load gallery settings.');
      const galleryData = await galleryRes.json();
      setGallery(galleryData);
      setSaved(galleryData);

      if (!imagesRes.ok) throw new Error('Failed to load images.');
      const imagesData = await imagesRes.json();
      setImages(imagesData || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSettingsSubmit = async (e) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/galleries/${galleryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: gallery.title,
          photographer_name: gallery.photographer_name,
          is_preview: gallery.is_preview
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update settings');
      setGallery(data);
      setSaved(data);
      setSuccess('Changes saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const [uploadStats, setUploadStats] = useState({
    currentFileIndex: 0,
    totalFiles: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    currentFileLoaded: 0
  });

  const formatMB = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setIsUploading(true);
    const totalBytes = files.reduce((acc, file) => acc + file.size, 0);
    setUploadStats({
      currentFileIndex: 0,
      totalFiles: files.length,
      totalBytes,
      uploadedBytes: 0,
      currentFileLoaded: 0,
      isWaitingForBackend: false
    });
    setError('');

    const uploadedImagesList = [];
    let hasError = false;

    const postJson = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      return data;
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        // 1. Get a presigned URL, 2. PUT the file straight to R2, 3. let the server finalize it
        const { url, key } = await postJson(`/api/galleries/${galleryId}/upload-url`, {
          contentType: file.type,
          size: file.size,
        });

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', url);
          xhr.setRequestHeader('Content-Type', file.type);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setUploadStats(prev => ({
                ...prev,
                currentFileLoaded: event.loaded,
                isWaitingForBackend: event.loaded === event.total
              }));
            }
          };

          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Storage upload failed (${xhr.status})`)));
          xhr.onerror = () => reject(new Error('Network error (check R2 CORS allows PUT from this site)'));
          xhr.send(file);
        });

        const uploadedImage = await postJson(`/api/galleries/${galleryId}/images`, { key });
        uploadedImagesList.push(uploadedImage);
        setUploadStats(prev => ({
          ...prev,
          currentFileIndex: prev.currentFileIndex + 1,
          uploadedBytes: prev.uploadedBytes + files[i].size,
          currentFileLoaded: 0,
          isWaitingForBackend: false
        }));
      } catch (err) {
        hasError = true;
        setError(`Failed to upload ${files[i].name}: ${err.message}`);
        break; // Stop uploading further files if one fails, or remove this to continue
      }
    }

    if (uploadedImagesList.length > 0) {
      setImages(prev => [...uploadedImagesList, ...prev]);
    }

    setIsUploading(false);
    e.target.value = ''; // Reset input

    if (!hasError) {
      setSuccess('All photos uploaded.');
      setTimeout(() => setSuccess(''), 3000);
    }
  };

  const handleDeleteImage = async (imageId) => {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/images/${imageId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete image');

      setImages(prev => prev.filter(img => img.id !== imageId));
      setSelectedImageIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(imageId);
        return newSet;
      });
    } catch (err) {
      setError(`Delete failed: ${err.message}`);
    }
  };

  const toggleSelection = (imageId) => {
    setSelectedImageIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) newSet.delete(imageId);
      else newSet.add(imageId);
      return newSet;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedImageIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedImageIds.size} photos? This cannot be undone.`)) return;

    let successCount = 0;
    let failCount = 0;
    const idsToDelete = Array.from(selectedImageIds);

    for (const id of idsToDelete) {
      try {
        const res = await fetch(`/api/images/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setImages(prev => prev.filter(img => img.id !== id));
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }

    setSelectedImageIds(new Set());
    if (failCount > 0) {
      setError(`Failed to delete ${failCount} images. (Deleted ${successCount})`);
    } else {
      setSuccess(`Successfully deleted ${successCount} images.`);
      setTimeout(() => setSuccess(''), 3000);
    }
  };

  const clientLink = `${window.location.origin}/view/${galleryId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(clientLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError(`Couldn’t copy automatically. The link is: ${clientLink}`);
    }
  };

  const progressPercent = (() => {
    // Each file counts 50% for the upload to storage, 50% for server processing
    const weight = uploadStats.uploadedBytes + uploadStats.currentFileLoaded * 0.5;
    return uploadStats.totalBytes > 0 ? Math.min(100, Math.round((weight / uploadStats.totalBytes) * 100)) : 0;
  })();

  return (
    <div className="min-h-screen pb-16">
      <AppHeader>
        <button onClick={handleCopyLink} className="btn btn-primary px-4 py-2">
          {linkCopied ? 'Link copied' : 'Copy gallery link'}
        </button>
        <a
          href={`/view/${galleryId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary px-4 py-2"
        >
          View as client
        </a>
      </AppHeader>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 border-b border-line pb-6">
          <button onClick={() => navigate('/dashboard')} className="eyebrow hover:text-ink">
            &larr; Your galleries
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-4xl font-medium">{saved?.title || ' '}</h1>
            {saved?.is_preview && (
              <span className="eyebrow rounded-sm border border-bean/40 px-2 py-1 text-bean">Preview on</span>
            )}
          </div>
        </div>

        {error && <div className="notice-error mb-6">{error}</div>}
        {success && <div className="notice-success mb-6">{success}</div>}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Settings */}
          <section className="lg:col-span-1">
            <div className="card p-6">
              <h2 className="mb-5 font-serif text-2xl font-medium">Details</h2>
              <form onSubmit={handleSettingsSubmit} className="space-y-5">
                <div>
                  <label htmlFor="edit-title" className="label">Gallery name</label>
                  <input
                    id="edit-title"
                    type="text"
                    required
                    value={gallery.title}
                    onChange={e => setGallery({ ...gallery, title: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor="edit-photographer" className="label">Photographer name</label>
                  <input
                    id="edit-photographer"
                    type="text"
                    required
                    value={gallery.photographer_name}
                    onChange={e => setGallery({ ...gallery, photographer_name: e.target.value })}
                    className="input"
                  />
                </div>
                <label htmlFor="edit-preview" className="flex cursor-pointer items-start gap-3 border-t border-line pt-5">
                  <input
                    id="edit-preview"
                    type="checkbox"
                    checked={!!gallery.is_preview}
                    onChange={e => setGallery({ ...gallery, is_preview: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded-sm border-line accent-ink"
                  />
                  <span>
                    <span className="block text-sm font-medium">Preview mode</span>
                    <span className="mt-0.5 block text-xs text-ink-soft">
                      Watermark photos and limit client downloads to 1200px previews.
                    </span>
                  </span>
                </label>
                <button type="submit" disabled={isSavingSettings} className="btn btn-primary w-full">
                  {isSavingSettings
                    ? (gallery.is_preview || gallery.photographer_name !== saved?.photographer_name ? 'Applying watermarks…' : 'Saving…')
                    : 'Save changes'}
                </button>
              </form>
            </div>
          </section>

          {/* Photos */}
          <section className="lg:col-span-2">
            <div className="card p-6">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-serif text-2xl font-medium">
                  Photos <span className="text-lg text-ink-muted">({images.length})</span>
                </h2>
                <div className="flex items-center gap-3">
                  {selectedImageIds.size > 0 && (
                    <button onClick={handleBulkDelete} className="btn btn-danger px-4 py-2">
                      Delete selected ({selectedImageIds.size})
                    </button>
                  )}
                  <label className={`btn btn-primary px-4 py-2 ${isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
                    {isUploading ? <><Spinner className="h-4 w-4" /> Uploading…</> : 'Upload photos'}
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg, image/png, image/webp"
                      onChange={handleFileUpload}
                      disabled={isUploading}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              {isUploading && (
                <div className="mb-6">
                  <div className="mb-2 flex justify-between text-sm text-ink-soft">
                    <span>
                      {uploadStats.isWaitingForBackend
                        ? `Processing photo ${uploadStats.currentFileIndex + 1} of ${uploadStats.totalFiles}…`
                        : `Uploading ${uploadStats.currentFileIndex + 1} of ${uploadStats.totalFiles} · ${formatMB(uploadStats.uploadedBytes + uploadStats.currentFileLoaded)} / ${formatMB(uploadStats.totalBytes)} MB`}
                    </span>
                    <span className="tabular-nums">{progressPercent}%</span>
                  </div>
                  <div className="h-1 w-full overflow-hidden bg-line">
                    <div className="h-1 bg-ink transition-all duration-300" style={{ width: `${progressPercent}%` }} />
                  </div>
                </div>
              )}

              {images.length === 0 ? (
                <div className="border border-dashed border-line px-6 py-14 text-center">
                  <p className="font-serif text-xl">No photos yet</p>
                  <p className="mt-1 text-sm text-ink-soft">JPEG, PNG or WebP, up to 50 MB each.</p>
                </div>
              ) : (
                <div className="columns-2 gap-3 space-y-3 sm:columns-3 lg:columns-4">
                  {images.map(image => {
                    const selected = selectedImageIds.has(image.id);
                    return (
                      <div
                        key={image.id}
                        className={`group relative cursor-pointer break-inside-avoid overflow-hidden bg-line transition ${selected ? 'ring-2 ring-ink ring-offset-2 ring-offset-white' : ''}`}
                        onClick={() => toggleSelection(image.id)}
                      >
                        <img
                          src={image.preview_url || image.image_url}
                          alt=""
                          className={`h-auto w-full transition-opacity duration-200 ${selected ? 'opacity-80' : ''}`}
                          loading="lazy"
                        />

                        {/* Selection checkbox */}
                        <div className={`absolute left-2 top-2 transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <div className={`flex h-5 w-5 items-center justify-center rounded-sm border ${selected ? 'border-ink bg-ink' : 'border-white bg-white/70'}`}>
                            {selected && (
                              <svg className="h-3.5 w-3.5 text-paper" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </div>

                        {/* Single delete */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteImage(image.id); }}
                          className="absolute right-2 top-2 rounded-sm bg-white/90 p-1.5 text-ink-soft opacity-0 transition-opacity hover:text-red-800 focus:opacity-100 group-hover:opacity-100"
                          title="Delete photo"
                          aria-label="Delete photo"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default GalleryEdit;
