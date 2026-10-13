import { useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Avatar, cx } from '../../ui/kit';
import { Logo } from '../../layouts/SiteLayout';
import { NotFound } from '../NotFound';
import { Dashboard } from './Dashboard';
import { EventsList, EventCreate } from './Events';
import { AdminEventLayout, EventSettingsTab } from './EventLayout';
import { SessionsTab } from './SessionsTab';
import { StructureTab } from './StructureTab';
import { PeopleTab } from './PeopleTab';
import { RegistrationsTab } from './RegistrationsTab';
import { CheckinTab } from './CheckinTab';
import { AnnouncementsTab } from './AnnouncementsTab';
import { ReportsTab } from './ReportsTab';
import { Badges } from './Badges';
import { UsersPage } from './UsersPage';
import { AuditPage } from './AuditPage';

const nav = [['/admin', 'Dashboard', true], ['/admin/events', 'Events', false], ['/admin/users', 'Users & admins', false], ['/admin/audit', 'Audit log', false]] as const;

export default function AdminApp() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const go = useNavigate();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14.5rem_1fr]">
      <aside className={cx('border-r border-line bg-white md:block', open ? 'block' : 'hidden')}>
        <div className="flex h-14 items-center border-b border-line px-4"><Logo /></div>
        <nav aria-label="Admin" className="flex flex-col gap-0.5 p-3 text-sm">
          {nav.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={({ isActive }) => cx('rounded-md px-3 py-2 font-medium', isActive ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-canvas')}>{label}</NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t border-line p-3 text-sm">
          <Link to="/" className="block rounded-md px-3 py-2 text-muted hover:bg-canvas">← Public site</Link>
          <button className="block w-full rounded-md px-3 py-2 text-left text-muted hover:bg-canvas" onClick={async () => { await logout(); go('/'); }}>Sign out</button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-14 items-center justify-between border-b border-line bg-white px-4">
          <button className="rounded p-2 md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
          <span className="hidden text-sm text-muted md:block">Control panel</span>
          <Link to="/account" className="flex items-center gap-2 text-sm"><Avatar name={user!.name} userId={user!.id} hasPhoto={user!.hasPhoto} size={28} />{user!.name}</Link>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-6">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="events" element={<EventsList />} />
            <Route path="events/new" element={<EventCreate />} />
            <Route path="events/:id/badges" element={<Badges />} />
            <Route path="events/:id" element={<AdminEventLayout />}>
              <Route index element={<EventSettingsTab />} />
              <Route path="sessions" element={<SessionsTab />} />
              <Route path="structure" element={<StructureTab />} />
              <Route path="people" element={<PeopleTab />} />
              <Route path="registrations" element={<RegistrationsTab />} />
              <Route path="checkin" element={<CheckinTab />} />
              <Route path="announcements" element={<AnnouncementsTab />} />
              <Route path="reports" element={<ReportsTab />} />
            </Route>
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
