import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import PhotoAlbum from 'react-photo-album';
import 'react-photo-album/styles.css';
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";

const GalleryView = () => {
  const { galleryId } = useParams();
  const [gallery, setGallery] = useState(null);
  const [images, setImages] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [galleryRes, imagesRes] = await Promise.all([
          fetch(`/api/galleries/${galleryId}`),
          fetch(`/api/galleries/${galleryId}/images`)
        ]);

        if (!galleryRes.ok) throw new Error('Gallery not found');
        const galleryData = await galleryRes.json();
        setGallery(galleryData);

        if (!imagesRes.ok) throw new Error('Failed to load images');
        const imagesData = await imagesRes.json();

        // Process images to get dimensions for react-photo-album
        const processedPhotos = await Promise.all((imagesData || []).map(img => {
          return new Promise((resolve) => {
            const image = new Image();
            image.src = img.preview_url || img.image_url;
            image.onload = () => {
              resolve({
                src: image.src,
                width: image.width,
                height: image.height,
                key: img.id,
                original_url: img.image_url
              });
            };
            image.onerror = () => {
              resolve({
                src: image.src,
                width: 1, // Fallback
                height: 1,
                key: img.id,
                original_url: img.image_url
              });
            };
          });
        }));

        setImages(imagesData || []);
        setPhotos(processedPhotos);
      } catch (err) {
        console.error('Error fetching gallery:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [galleryId]);

  const handleDownloadAll = async () => {
    if (images.length === 0) return;
    setIsDownloading(true);

    try {
      const zip = new JSZip();

      // Fetch all image blobs concurrently
      const fetchPromises = images.map(async (image, index) => {
        const url = image.image_url;
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const blob = await response.blob();

          // Generate a clean filename: GalleryTitle_001.jpg
          const safeTitle = (gallery?.title || 'Gallery').replace(/[^a-z0-9]/gi, '_').toLowerCase();
          const extension = url.split('.').pop().split('?')[0] || 'jpg';
          const filename = `${safeTitle}_${String(index + 1).padStart(3, '0')}.${extension}`;

          zip.file(filename, blob);
        } catch (err) {
          console.error(`Failed to fetch image ${url}`, err);
        }
      });

      await Promise.all(fetchPromises);

      // Generate the zip file
      const content = await zip.generateAsync({ type: 'blob' });

      // Trigger download
      const safeTitle = (gallery?.title || 'Gallery').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      saveAs(content, `${safeTitle}_photos.zip`);
    } catch (err) {
      console.error('Error generating zip:', err);
      alert('Failed to generate the ZIP file. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h2>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-white py-16 px-4 sm:px-6 lg:px-8 border-b border-gray-200">
        <div className="max-w-7xl mx-auto flex flex-col items-center relative">
          <h1 className="text-4xl sm:text-5xl font-serif text-gray-900 tracking-tight text-center">
            {gallery?.title}
          </h1>
          <p className="mt-3 text-sm sm:text-base text-gray-500 uppercase tracking-widest font-medium text-center">
            Photography by {gallery?.photographer_name}
          </p>
          <div className="mt-8 sm:absolute sm:right-0 sm:top-1/2 sm:-translate-y-1/2 sm:mt-0">
            <button
              onClick={handleDownloadAll}
              disabled={isDownloading || images.length === 0}
              className="inline-flex items-center px-6 py-3 bg-gray-900 text-white text-sm font-semibold shadow-sm hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generating ZIP...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download All
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-8 mt-4">
        {photos.length === 0 ? (
          <p className="text-gray-500 italic text-center mt-12">No images in this gallery yet.</p>
        ) : (
          <div className="photo-album-container">
            <PhotoAlbum
              layout="rows"
              photos={photos}
              targetRowHeight={300}
              onClick={({ index }) => setLightboxIndex(index)}
            />

            <Lightbox
              slides={photos.map(p => ({ src: p.src, width: p.width, height: p.height }))}
              open={lightboxIndex >= 0}
              index={lightboxIndex}
              close={() => setLightboxIndex(-1)}
              styles={{
                root: {
                  "--yarl__color_backdrop": "rgba(255, 255, 255, 0.98)",
                  "--yarl__color_button": "#bcbdbfff",
                  "--yarl__color_button_active": "#d3d4d6ff",
                }
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default GalleryView;
