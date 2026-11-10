import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FullPageSpinner } from './Brand';

const ProtectedRoute = () => {
  const { user, loading } = useAuth();

  if (loading) return <FullPageSpinner />;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
