import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { get } from '../lib/api';
import { Avatar, cx } from '../ui/kit';

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx('flex items-center gap-2 font-bold tracking-tight', className)}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="7" fill="#1d5f8f" /><rect x="6" y="9" width="20" height="17" rx="3" fill="#fff" /><rect x="6" y="9" width="20" height="5" rx="2" fill="#f5b83d" /><rect x="10" y="17" width="4" height="3" rx="1" fill="#1d5f8f" /><rect x="16" y="17" width="6" height="3" rx="1" fill="#1d5f8f" /></svg>
      <span>SCHED<span className="text-brand">uling</span></span>
    </Link>
  );
}

export function useUnread() {
  const { user } = useAuth();
  const loc = useLocation();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!user) { setN(0); return; }
    let live = true;
    get('/api/comms/notifications').then((r) => live && setN(r.unread)).catch(() => {});
    return () => { live = false; };
  }, [user, loc.pathname]);
  return n;
}

export function SiteLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const unread = useUnread();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-1.5 text-sm">
            <NavLink to="/" end className={({ isActive }) => cx('hidden rounded px-3 py-2 sm:block hover:bg-black/5', isActive && 'font-semibold')}>Events</NavLink>
            {user?.role === 'admin' && <Link to="/admin" className="rounded px-3 py-2 font-medium text-brand hover:bg-brand-soft">Admin</Link>}
            {user ? (
              <>
                <Link to="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative rounded p-2 hover:bg-black/5">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
                  {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
                </Link>
                <div className="relative">
                  <button aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded p-1 hover:bg-black/5">
                    <Avatar name={user.name} userId={user.id} hasPhoto={user.hasPhoto} size={30} />
                    <span className="hidden max-w-32 truncate sm:block">{user.name}</span>
                  </button>
                  {menu && (
                    <div role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-line bg-white py-1 shadow-lg">
                      <Link role="menuitem" to="/account" className="block px-3 py-2 hover:bg-canvas">Account</Link>
                      <button role="menuitem" className="block w-full px-3 py-2 text-left hover:bg-canvas" onClick={async () => { await logout(); nav('/'); }}>Sign out</button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Link to={`/login?next=${encodeURIComponent(loc.pathname)}`} className="rounded px-3 py-2 hover:bg-black/5">Sign in</Link>
                <Link to={`/signup?next=${encodeURIComponent(loc.pathname)}`} className="rounded-md bg-brand px-3.5 py-2 font-medium text-brand-ink hover:brightness-110">Sign up</Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1"><Outlet /></main>
      <footer className="border-t border-line bg-white py-5 text-center text-xs text-muted">SCHEDuling · event scheduling</footer>
    </div>
  );
}
