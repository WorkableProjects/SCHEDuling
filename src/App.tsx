import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { SiteLayout } from './layouts/SiteLayout';
import { EventLayout } from './layouts/EventLayout';
import { Home } from './pages/Home';
import { Login, Signup, Activate, Setup } from './pages/AuthPages';
import { Account } from './pages/Account';
import { Notifications } from './pages/Notifications';
import { NotFound } from './pages/NotFound';
import { Welcome } from './pages/event/Welcome';
import { Schedule } from './pages/event/Schedule';
import { SessionPage } from './pages/event/SessionPage';
import { Speakers } from './pages/event/Speakers';
import { Directory } from './pages/event/Directory';
import { MyAgenda } from './pages/event/MyAgenda';
import { Ticket } from './pages/event/Ticket';
import { ListSkeleton } from './ui/kit';

const AdminApp = lazy(() => import('./pages/admin/AdminApp'));
const CheckinApp = lazy(() => import('./pages/Checkin'));

function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="mx-auto max-w-3xl p-6"><ListSkeleton rows={3} /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!roles.includes(user.role)) return <NotFound message="You don't have access to this page." />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl p-6"><ListSkeleton rows={3} /></div>}>
      <Routes>
        <Route path="/admin/*" element={<RequireRole roles={['admin']}><AdminApp /></RequireRole>} />
        <Route path="/checkin/:slug" element={<RequireRole roles={['admin', 'checkin_staff']}><CheckinApp /></RequireRole>} />
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/activate/:token" element={<Activate />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/account" element={<RequireRole roles={['admin', 'speaker', 'attendee', 'checkin_staff']}><Account /></RequireRole>} />
          <Route path="/notifications" element={<RequireRole roles={['admin', 'speaker', 'attendee', 'checkin_staff']}><Notifications /></RequireRole>} />
          <Route path="/e/:slug" element={<EventLayout />}>
            <Route index element={<Welcome />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="session/:id" element={<SessionPage />} />
            <Route path="speakers" element={<Speakers />} />
            <Route path="speaker/:id" element={<Speakers />} />
            <Route path="directory" element={<Directory />} />
            <Route path="my-agenda" element={<MyAgenda />} />
            <Route path="ticket" element={<Ticket />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
