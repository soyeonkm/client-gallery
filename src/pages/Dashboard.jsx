import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import CreateGalleryModal from '../components/CreateGalleryModal';
import { AppHeader, Spinner } from '../components/Brand';

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [galleries, setGalleries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(null);

  useEffect(() => {
    fetchGalleries();
  }, [user.id]);

  const fetchGalleries = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/galleries');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGalleries(data || []);
    } catch (err) {
      console.error('Error fetching galleries:', err);
      setError('We couldn’t load your galleries. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  const openModal = () => {
    setCreateError('');
    setIsModalOpen(true);
  };

  const handleCreateGallery = async ({ title, photographer_name }) => {
    setCreateError('');
    try {
      const res = await fetch('/api/galleries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, photographer_name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setGalleries([data, ...galleries]);
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error creating gallery:', err);
      setCreateError('The gallery couldn’t be created. Please try again.');
    }
  };

  const handleDeleteGallery = async (gallery) => {
    if (!window.confirm(`Delete "${gallery.title}" and all its photos? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/galleries/${gallery.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGalleries((prev) => prev.filter((g) => g.id !== gallery.id));
    } catch (err) {
      console.error('Error deleting gallery:', err);
      setError(`“${gallery.title}” couldn’t be deleted: ${err.message}`);
    }
  };

  const copyToClipboard = async (galleryId) => {
    const url = `${window.location.origin}/view/${galleryId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback(galleryId);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      console.error('Failed to copy!', err);
      setError(`Couldn’t copy automatically. The link is: ${url}`);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader>
        <span className="hidden text-sm text-ink-soft sm:inline">{user.email}</span>
        <button onClick={signOut} className="btn btn-secondary px-4 py-2">
          Sign out
        </button>
      </AppHeader>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1 className="mt-1 font-serif text-4xl font-medium">Your galleries</h1>
          </div>
          <button onClick={openModal} className="btn btn-primary">
            New gallery
          </button>
        </div>

        {error && <div className="notice-error mb-6">{error}</div>}

        {isLoading ? (
          <div className="flex justify-center py-16 text-ink">
            <Spinner className="h-6 w-6" />
          </div>
        ) : galleries.length === 0 ? (
          <div className="card px-6 py-16 text-center">
            <h2 className="font-serif text-2xl font-medium">No galleries yet</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Create a gallery, upload your photos, and send your client a private link.
            </p>
            <button onClick={openModal} className="btn btn-primary mt-6">
              Create your first gallery
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {galleries.map((gallery) => (
              <div key={gallery.id} className="card flex flex-col">
                <div className="flex-grow p-6">
                  <h3 className="line-clamp-1 font-serif text-2xl font-medium">
                    <Link to={`/gallery/${gallery.id}/edit`} className="hover:text-bean">
                      {gallery.title}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-ink-soft">By {gallery.photographer_name}</p>
                  <p className="eyebrow mt-4">
                    Created{' '}
                    {new Date(gallery.created_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-line px-6 py-3 text-sm">
                  <Link to={`/gallery/${gallery.id}/edit`} className="font-medium text-ink hover:text-bean">
                    Manage
                  </Link>
                  <div className="flex items-center gap-5">
                    <button
                      onClick={() => copyToClipboard(gallery.id)}
                      className="font-medium text-ink-soft hover:text-ink"
                    >
                      {copyFeedback === gallery.id ? <span className="text-emerald-700">Link copied</span> : 'Copy link'}
                    </button>
                    <button
                      onClick={() => handleDeleteGallery(gallery)}
                      className="font-medium text-ink-muted hover:text-red-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <CreateGalleryModal
        isOpen={isModalOpen}
        error={createError}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateGallery}
      />
    </div>
  );
};

export default Dashboard;
