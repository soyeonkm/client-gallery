import { useState } from 'react';

const CreateGalleryModal = ({ isOpen, error, onClose, onSubmit }) => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div role="dialog" aria-modal="true" aria-labelledby="create-gallery-title" className="card w-full max-w-md p-8">
        <h2 id="create-gallery-title" className="mb-6 font-serif text-3xl font-medium">
          New gallery
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="gallery-title" className="label">Gallery name</label>
            <input
              id="gallery-title"
              type="text"
              required
              maxLength={100}
              className="input"
              placeholder="e.g. Smith Wedding"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="photographer-name" className="label">Photographer name</label>
            <input
              id="photographer-name"
              type="text"
              required
              maxLength={100}
              className="input"
              placeholder="Shown to your client"
              value={photographerName}
              onChange={(e) => setPhotographerName(e.target.value)}
            />
          </div>

          {error && <div className="notice-error">{error}</div>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="btn btn-primary">
              {isSubmitting ? 'Creating…' : 'Create gallery'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGalleryModal;
