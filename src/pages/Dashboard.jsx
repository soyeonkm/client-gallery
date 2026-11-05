import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import CreateGalleryModal from '../components/CreateGalleryModal';

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [galleries, setGalleries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
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
      setError('Failed to load galleries.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGallery = async ({ title, photographer_name }) => {
    try {
      const res = await fetch('/api/galleries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, photographer_name }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);
      
      if (data) {
        setGalleries([data, ...galleries]);
        setIsModalOpen(false);
      }
    } catch (err) {
      console.error('Error creating gallery:', err);
      alert('Failed to create gallery. Make sure the database tables are set up correctly.');
    }
  };

  const handleDeleteGallery = async (gallery) => {
    if (!window.confirm(`Delete "${gallery.title}" and all its photos? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/galleries/${gallery.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGalleries((prev) => prev.filter((g) => g.id !== gallery.id));
    } catch (err) {
      console.error('Error deleting gallery:', err);
      alert(`Failed to delete gallery: ${err.message}`);
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
      alert('Failed to copy link.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Photographer Dashboard</h1>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500 hidden sm:inline-block">{user.email}</span>
            <button 
              onClick={signOut}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm font-medium transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl font-semibold">Your Galleries</h2>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium transition-colors shadow-sm"
          >
            + Create New Gallery
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6 border border-red-100">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : galleries.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border border-dashed border-gray-300">
            <p className="text-gray-500 mb-4">You haven't created any galleries yet.</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Create your first gallery
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {galleries.map((gallery) => (
              <div key={gallery.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
                <div className="p-6 flex-grow">
                  <h3 className="text-lg font-bold text-gray-900 mb-1 line-clamp-1">{gallery.title}</h3>
                  <p className="text-sm text-gray-500 mb-4">By {gallery.photographer_name}</p>
                  <p className="text-xs text-gray-400">
                    Created {new Date(gallery.created_at).toLocaleDateString()}
                  </p>
                </div>
                
                <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 flex justify-between items-center">
                  <Link
                    to={`/gallery/${gallery.id}/edit`}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Edit Settings
                  </Link>
                  <button
                    onClick={() => handleDeleteGallery(gallery)}
                    className="text-sm font-medium text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => copyToClipboard(gallery.id)}
                    className="text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center"
                  >
                    {copyFeedback === gallery.id ? (
                      <span className="text-green-600">Copied!</span>
                    ) : (
                      'Copy Link'
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <CreateGalleryModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSubmit={handleCreateGallery} 
      />
    </div>
  );
};

export default Dashboard;
