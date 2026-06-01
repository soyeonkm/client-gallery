import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const GalleryEdit = () => {
  const { galleryId } = useParams();
  const navigate = useNavigate();

  const [gallery, setGallery] = useState({ title: '', photographer_name: '' });
  const [images, setImages] = useState([]);

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedImageIds, setSelectedImageIds] = useState(new Set());

  useEffect(() => {
    fetchGalleryData();
  }, [galleryId]);

  const fetchGalleryData = async () => {
    try {
      const [galleryRes, imagesRes] = await Promise.all([
        fetch(`/api/galleries/${galleryId}`),
        fetch(`/api/galleries/${galleryId}/images`)
      ]);

      if (!galleryRes.ok) throw new Error('Failed to load gallery settings.');
      const galleryData = await galleryRes.json();
      setGallery(galleryData);

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
          photographer_name: gallery.photographer_name
        })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update settings');
      }
      setSuccess('Settings updated successfully!');
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

    for (let i = 0; i < files.length; i++) {
      const formData = new FormData();
      formData.append('images', files[i]);

      try {
        const uploadedImages = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `/api/galleries/${galleryId}/images`);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setUploadStats(prev => ({ 
                ...prev, 
                currentFileLoaded: event.loaded,
                isWaitingForBackend: event.loaded === event.total
              }));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(JSON.parse(xhr.responseText));
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error || 'Upload failed'));
              } catch {
                reject(new Error('Upload failed'));
              }
            }
          };

          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(formData);
        });

        uploadedImagesList.push(...uploadedImages);
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
      setSuccess('All images uploaded successfully!');
      setTimeout(() => setSuccess(''), 3000);
    }
  };

  const handleDeleteImage = async (imageId) => {
    if (!window.confirm('Are you sure you want to delete this image?')) return;

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
      alert(`Delete failed: ${err.message}`);
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
    if (!window.confirm(`Are you sure you want to delete ${selectedImageIds.size} images?`)) return;

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

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-indigo-600 hover:text-indigo-800 font-medium text-sm"
            >
              &larr; Back to Dashboard
            </button>
            <h1 className="text-xl font-bold text-gray-900 border-l pl-4 border-gray-300">
              Editing: {gallery.title || 'Loading...'}
            </h1>
          </div>
          <a
            href={`/view/${galleryId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 font-medium"
          >
            View Public Link
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">

        {/* Messages */}
        {error && <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-md border border-red-100">{error}</div>}
        {success && <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-md border border-green-100">{success}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Settings Section */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Gallery Settings</h2>
              <form onSubmit={handleSettingsSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gallery Name</label>
                  <input
                    type="text"
                    required
                    value={gallery.title}
                    onChange={e => setGallery({ ...gallery, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Photographer Name</label>
                  <input
                    type="text"
                    required
                    value={gallery.photographer_name}
                    onChange={e => setGallery({ ...gallery, photographer_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {isSavingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </form>
            </div>
          </div>

          {/* Images Section */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-bold text-gray-900">Manage Images</h2>
                <div className="flex items-center space-x-3">
                  {selectedImageIds.size > 0 && (
                    <button
                      onClick={handleBulkDelete}
                      className="px-3 py-2 border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 rounded-md shadow-sm text-sm font-medium transition-colors"
                    >
                      Delete Selected ({selectedImageIds.size})
                    </button>
                  )}
                  <div className="relative">
                    <input
                    type="file"
                    multiple
                    accept="image/jpeg, image/png, image/webp"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <button
                    disabled={isUploading}
                    className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center space-x-2"
                  >
                    {isUploading ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <span>+ Upload Images</span>
                    )}
                  </button>
                </div>
              </div>
            </div>

              {isUploading && (
                (() => {
                  // Calculate progress where each file is 50% uploading, 50% server processing
                  const completedFilesWeight = uploadStats.uploadedBytes;
                  const currentFileWeight = uploadStats.currentFileLoaded * 0.5;
                  const totalWeight = completedFilesWeight + currentFileWeight;
                  
                  const progressPercent = uploadStats.totalBytes > 0
                    ? Math.min(100, Math.round((totalWeight / uploadStats.totalBytes) * 100))
                    : 0;

                  const literalTotalUploaded = uploadStats.uploadedBytes + uploadStats.currentFileLoaded;
                  const isProcessing = uploadStats.isWaitingForBackend;

                  return (
                    <div className="mb-6">
                      <div className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                        <span>
                          {isProcessing
                            ? `Processing image ${uploadStats.currentFileIndex + 1} on server...`
                            : `Uploading ${uploadStats.currentFileIndex + 1} of ${uploadStats.totalFiles} (${formatMB(literalTotalUploaded)}MB / ${formatMB(uploadStats.totalBytes)}MB)`
                          }
                        </span>
                        <span>{progressPercent}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`bg-indigo-600 h-2 rounded-full transition-all duration-300 ${isProcessing ? 'animate-pulse' : 'progress-bar-animated'}`}
                          style={{ width: `${progressPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Image Grid */}
              {images.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
                  <p className="text-gray-500">No images uploaded yet.</p>
                </div>
              ) : (
                <div className="columns-2 sm:columns-3 lg:columns-4 gap-4 space-y-4">
                  {images.map(image => (
                    <div 
                      key={image.id} 
                      className={`relative group bg-gray-100 overflow-hidden border break-inside-avoid cursor-pointer transition-all ${selectedImageIds.has(image.id) ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 hover:border-gray-300'}`}
                      onClick={() => toggleSelection(image.id)}
                    >
                      <img
                        src={image.preview_url || image.image_url}
                        alt="Gallery upload"
                        className={`w-full h-auto transition-transform duration-200 ${selectedImageIds.has(image.id) ? 'scale-95' : 'group-hover:scale-[1.02]'}`}
                        loading="lazy"
                      />
                      
                      {/* Checkbox Overlay */}
                      <div className={`absolute top-2 left-2 z-10 transition-opacity duration-200 ${selectedImageIds.has(image.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedImageIds.has(image.id) ? 'bg-indigo-600 border-indigo-600' : 'bg-white/80 border-gray-400 backdrop-blur-sm'}`}>
                          {selectedImageIds.has(image.id) && (
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>

                      {/* Single Delete Button Overlay */}
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all flex items-center justify-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteImage(image.id); }}
                          className="opacity-0 group-hover:opacity-100 bg-red-600/90 backdrop-blur-sm text-white p-2 rounded-full hover:bg-red-700 shadow-sm transition-opacity duration-200 hover:scale-110"
                          title="Delete Image"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default GalleryEdit;
