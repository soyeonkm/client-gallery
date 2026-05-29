import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const GalleryEdit = () => {
  const { galleryId } = useParams();
  const navigate = useNavigate();

  const [gallery, setGallery] = useState({ title: '', photographer_name: '' });
  const [images, setImages] = useState([]);

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Optional client side size check (let's say warn if over 20MB)
    // const largeFiles = files.filter(f => f.size > 20 * 1024 * 1024);
    // if (largeFiles.length > 0) {
    //   if (!window.confirm('Some files are very large (>20MB) and may take a while to upload. Continue?')) {
    //     e.target.value = '';
    //     return;
    //   }
    // }

    setIsUploading(true);
    setError('');

    const formData = new FormData();
    files.forEach(file => formData.append('images', file));

    try {
      const res = await fetch(`/api/galleries/${galleryId}/images`, {
        method: 'POST',
        body: formData, // fetch automatically sets multipart/form-data boundary
      });

      const uploadedImages = await res.json();
      if (!res.ok) throw new Error(uploadedImages.error || 'Upload failed');

      // Add new images to state
      setImages(prev => [...uploadedImages, ...prev]);
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = ''; // Reset input
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
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
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

              {/* Image Grid */}
              {images.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
                  <p className="text-gray-500">No images uploaded yet.</p>
                </div>
              ) : (
                <div className="columns-2 sm:columns-3 lg:columns-4 gap-4 space-y-4">
                  {images.map(image => (
                    <div key={image.id} className="relative group bg-gray-100 overflow-hidden border border-gray-200 break-inside-avoid">
                      <img
                        src={image.preview_url || image.image_url}
                        alt="Gallery upload"
                        className="w-full h-auto"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => handleDeleteImage(image.id)}
                          className="bg-red-600 text-white p-2 rounded-full hover:bg-red-700 shadow-sm"
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
