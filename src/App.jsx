import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import GalleryEdit from './pages/GalleryEdit';
import GalleryView from './pages/GalleryView';
import ResetPassword from './pages/ResetPassword';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/view/:galleryId" element={<GalleryView />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/gallery/:galleryId/edit" element={<GalleryEdit />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
