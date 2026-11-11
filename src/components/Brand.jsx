import { Link } from 'react-router-dom';

export const Wordmark = ({ className = '' }) => (
  <span className={`font-serif font-semibold tracking-tight text-ink ${className}`}>
    Bean <span className="font-medium italic text-bean">&amp;</span> Grain
  </span>
);

export const Spinner = ({ className = '' }) => (
  <span role="status" aria-label="Loading" className={`spinner ${className}`} />
);

export const FullPageSpinner = () => (
  <div className="flex min-h-screen items-center justify-center text-ink">
    <Spinner className="h-7 w-7" />
  </div>
);

// Header for the photographer-facing pages
export const AppHeader = ({ children }) => (
  <header className="border-b border-line bg-paper">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <Link to="/dashboard" className="text-2xl">
        <Wordmark />
      </Link>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  </header>
);

// Centered layout for sign-in / password pages
export const AuthShell = ({ title, children, footer }) => (
  <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
    <div className="mb-10 text-center">
      <Wordmark className="text-4xl" />
      <p className="eyebrow mt-3">Client galleries for photographers</p>
    </div>
    <div className="card w-full max-w-sm p-8">
      <h1 className="mb-6 font-serif text-3xl font-medium">{title}</h1>
      {children}
    </div>
    {footer && <div className="mt-6 text-sm text-ink-soft">{footer}</div>}
  </div>
);
