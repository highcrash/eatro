import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, Key, ShieldCheck, ScrollText, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/purchase-codes', label: 'Purchase Codes', icon: Key },
  { to: '/licenses', label: 'Licenses', icon: ShieldCheck },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  return (
    <div className="min-h-screen flex bg-white-warm">
      <aside className="w-56 bg-black-rich text-white flex flex-col">
        <div className="px-5 py-6 border-b border-black-lite">
          <p className="font-display text-2xl tracking-widest text-white">LICENSE</p>
          <p className="text-[10px] tracking-widest font-body text-white/40 uppercase mt-0.5">Admin</p>
        </div>

        <nav className="flex-1 py-4">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2.5 font-body text-sm transition-colors ${
                  isActive ? 'bg-red text-white' : 'text-white/70 hover:bg-black-lite hover:text-white'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-black-lite">
          <p className="text-[10px] text-white/50 font-body uppercase tracking-widest">Signed in</p>
          <p className="text-sm font-body truncate">{user?.email}</p>
          <button
            onClick={clearAuth}
            className="mt-3 flex items-center gap-2 text-xs text-white/60 hover:text-white font-body"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="px-10 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
