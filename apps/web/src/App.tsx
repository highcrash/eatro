import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import SiteLayout from './components/SiteLayout';
import HomePage from './pages/HomePage';
import MenuPage from './pages/MenuPage';
import MenuItemPage from './pages/MenuItemPage';
import MenuPrintPage from './pages/MenuPrintPage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import ReservationPage from './pages/ReservationPage';
import ChefsSpecialPage from './pages/ChefsSpecialPage';
import DiscountsPage from './pages/DiscountsPage';
import NotFoundPage from './pages/NotFoundPage';
import MaintenancePage from './pages/MaintenancePage';
import { useWebsiteContent } from './lib/cms';

/** Scroll to top on every route change */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function WebApp() {
  const { data: content } = useWebsiteContent();

  // Maintenance mode — show maintenance page for all routes
  if ((content as any)?.maintenanceMode) {
    return <MaintenancePage />;
  }

  return (
    <>
    <ScrollToTop />
    <Routes>
      {/* /menu-print is rendered WITHOUT SiteLayout — no nav, no footer,
          so the printable A4 hardcopy stays clean. */}
      <Route path="/menu-print" element={<MenuPrintPage />} />
      <Route element={<SiteLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/menu/:itemId" element={<MenuItemPage />} />
        <Route path="/chefs-special" element={<ChefsSpecialPage />} />
        <Route path="/deals" element={<DiscountsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/reservation" element={<ReservationPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </>
  );
}
