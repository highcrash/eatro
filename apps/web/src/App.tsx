import { Routes, Route } from 'react-router-dom';
import SiteLayout from './components/SiteLayout';
import HomePage from './pages/HomePage';
import MenuPage from './pages/MenuPage';
import MenuItemPage from './pages/MenuItemPage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import ReservationPage from './pages/ReservationPage';
import NotFoundPage from './pages/NotFoundPage';
import MaintenancePage from './pages/MaintenancePage';
import { useWebsiteContent } from './lib/cms';

export default function WebApp() {
  const { data: content } = useWebsiteContent();

  // Maintenance mode — show maintenance page for all routes
  if ((content as any)?.maintenanceMode) {
    return <MaintenancePage />;
  }

  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/menu/:itemId" element={<MenuItemPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/reservation" element={<ReservationPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
