import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import PhotoAlbum from 'react-photo-album';
import 'react-photo-album/styles.css';
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { FullPageSpinner, Spinner, Wordmark } from '../components/Brand';

const GalleryView = () => {
  const { galleryId } = useParams();
  const [gallery, setGallery] = useState(null);
  const [images, setImages] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [isSingleDownloading, setIsSingleDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

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

  const handleDownloadSingle = async () => {
    const photo = photos[lightboxIndex];
    if (!photo) return;
    setIsSingleDownloading(true);
    try {
      const url = photo.original_url || photo.src;
      const response = await fetch(url);
      const blob = await response.blob();
      const safeTitle = (gallery?.title || 'photo').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const ext = url.split('.').pop().split('?')[0] || 'jpg';
      saveAs(blob, `${safeTitle}_${String(lightboxIndex + 1).padStart(3, '0')}.${ext}`);
    } catch (err) {
      console.error('Single image download failed:', err);
    } finally {
      setIsSingleDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (images.length === 0) return;
    setIsDownloading(true);
    setDownloadError('');

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
      setDownloadError('The download couldn’t be prepared. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) return <FullPageSpinner />;

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <h1 className="font-serif text-4xl font-medium">This gallery isn’t available</h1>
        <p className="mt-3 max-w-sm text-ink-soft">
          The link may be incorrect, or the gallery may have been removed. Please check with your photographer.
        </p>
        <p className="mt-12 text-xs text-ink-muted">
          <Wordmark className="text-base" />
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line px-4 pb-12 pt-16 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="eyebrow">Photography by {gallery?.photographer_name}</p>
          <h1 className="mt-4 font-serif text-4xl font-medium leading-tight sm:text-6xl">{gallery?.title}</h1>
          <p className="mt-4 text-sm text-ink-soft">
            {images.length} {images.length === 1 ? 'photograph' : 'photographs'}
          </p>
          <button
            onClick={handleDownloadAll}
            disabled={isDownloading || images.length === 0}
            className="btn btn-secondary mt-8"
          >
            {isDownloading ? (
              <>
                <Spinner className="h-4 w-4" />
                Preparing download…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download all
              </>
            )}
          </button>
          {downloadError && <div className="notice-error mt-6 text-left">{downloadError}</div>}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-grow p-4 sm:p-8">
        {photos.length === 0 ? (
          <p className="mt-12 text-center font-serif text-xl italic text-ink-soft">No photographs here yet.</p>
        ) : (
          <div className="photo-album-container">
            <PhotoAlbum
              layout="rows"
              photos={photos}
              targetRowHeight={300}
              spacing={8}
              onClick={({ index }) => setLightboxIndex(index)}
            />

            <Lightbox
              slides={photos.map(p => ({ src: p.src, width: p.width, height: p.height }))}
              open={lightboxIndex >= 0}
              index={lightboxIndex}
              close={() => setLightboxIndex(-1)}
              toolbar={{
                buttons: [
                  <button
                    key="download"
                    type="button"
                    title="Download photo"
                    aria-label="Download photo"
                    disabled={isSingleDownloading}
                    onClick={handleDownloadSingle}
                    className="yarl__button"
                    style={{ opacity: isSingleDownloading ? 0.5 : 1 }}
                  >
                    {isSingleDownloading ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    )}
                  </button>,
                  "close"
                ]
              }}
              styles={{
                root: {
                  "--yarl__color_backdrop": "rgba(250, 248, 245, 0.98)",
                  "--yarl__color_button": "#57534E",
                  "--yarl__color_button_active": "#1C1B19",
                }
              }}
            />
          </div>
        )}
      </main>

      <footer className="border-t border-line py-8 text-center text-xs text-ink-muted">
        Delivered with <Wordmark className="text-sm" />
      </footer>
    </div>
  );
};

export default GalleryView;
