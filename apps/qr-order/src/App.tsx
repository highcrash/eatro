import { Routes, Route, Navigate } from 'react-router-dom';

import TableEntry from './pages/TableEntry';
import MenuPage from './pages/MenuPage';
import ItemPage from './pages/ItemPage';
import CartPage from './pages/CartPage';
import OrderStatusPage from './pages/OrderStatusPage';

export default function QrOrderApp() {
  return (
    <Routes>
      <Route path="/table/:tableId" element={<TableEntry />} />
      <Route path="/menu" element={<MenuPage />} />
      <Route path="/item/:itemId" element={<ItemPage />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/order/:orderId" element={<OrderStatusPage />} />
      <Route path="*" element={<Navigate to="/menu" replace />} />
    </Routes>
  );
}
