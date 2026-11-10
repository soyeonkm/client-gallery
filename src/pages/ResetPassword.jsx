import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/Brand';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [accessToken, setAccessToken] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const type = params.get('type');
    const token = params.get('access_token');

    if (type === 'recovery' && token) {
      setAccessToken(token);
    } else {
      setError('Invalid or expired password reset link. Please request a new one.');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: accessToken, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password.');
      setSuccess(true);
      setTimeout(() => navigate('/'), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Set a new password">
      {success ? (
        <div className="notice-success">Password updated. Taking you to sign in…</div>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="new-password" className="label">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              disabled={!accessToken}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="label">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              disabled={!accessToken}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input"
            />
          </div>

          {error && <div className="notice-error">{error}</div>}

          <button type="submit" disabled={loading || !accessToken} className="btn btn-primary w-full">
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}
    </AuthShell>
  );
};

export default ResetPassword;
