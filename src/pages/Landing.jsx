import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { AuthShell } from '../components/Brand';

const Landing = () => {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If already logged in, redirect to dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login(email, password, !isLogin);
    } catch (err) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={isLogin ? 'Sign in' : 'Create your account'}
      footer={
        <button type="button" className="link" onClick={() => { setIsLogin(!isLogin); setError(''); }}>
          {isLogin ? 'New to Bean & Grain? Create an account' : 'Already have an account? Sign in'}
        </button>
      }
    >
      <form className="space-y-5" onSubmit={handleAuth}>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="notice-error">{error}</div>}

        <button type="submit" disabled={loading} className="btn btn-primary w-full">
          {loading ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
};

export default Landing;
