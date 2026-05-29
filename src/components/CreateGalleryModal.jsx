import { useState } from 'react';

const CreateGalleryModal = ({ isOpen, onClose, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [photographerName, setPhotographerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    await onSubmit({ title, photographer_name: photographerName });
    setIsSubmitting(false);
    setTitle('');
    setPhotographerName('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4 text-gray-900">Create New Gallery</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="gallery-title" className="block text-sm font-medium text-gray-700 mb-1">
              Gallery Name
            </label>
            <input
              id="gallery-title"
              type="text"
              required
              maxLength={100}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Smith Wedding"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          
          <div className="mb-6">
            <label htmlFor="photographer-name" className="block text-sm font-medium text-gray-700 mb-1">
              Photographer Name
            </label>
            <input
              id="photographer-name"
              type="text"
              required
              maxLength={100}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Jane Doe"
              value={photographerName}
              onChange={(e) => setPhotographerName(e.target.value)}
            />
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Gallery'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGalleryModal;
