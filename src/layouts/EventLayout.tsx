import { createContext, useContext, useEffect } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { get } from '../lib/api';
import { useQuery, type Query } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { fmtDateRange } from '../lib/format';
import { cx, ErrorState, ListSkeleton } from '../ui/kit';
import { NotFound } from '../pages/NotFound';

export type EventSettings = { allowConflicts: boolean; directoryVisible: boolean; selfCheckin: boolean; speakerEdit: boolean; showCapacityLabels: boolean; scheduleFrozen: boolean };
export type EventInfo = {
  id: string; slug: string; name: string; description: string | null; tz: string; startDate: string; endDate: string; location: string | null;
  branding: { primaryColor?: string; bannerText?: string; footerText?: string }; privacy: 'public' | 'invite_only' | 'password'; published: boolean; archived: boolean;
  settings?: EventSettings;
};
export type Membership = { roleInEvent: string; ticketType: string; checkedInAt: string | null; qrToken: string } | null;
type EventData = { event: EventInfo; canView: boolean; locked: boolean; membership: Membership };
const Ctx = createContext<Query<EventData> & { slug: string }>(null as never);
export const useEvent = () => useContext(Ctx);

export function EventLayout() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const q = useQuery(() => get<EventData>(`/api/events/${slug}`), [slug, user?.id]);
  const ev = q.data?.event;
  useEffect(() => {
    const root = document.documentElement;
    if (ev?.branding.primaryColor) root.style.setProperty('--brand', ev.branding.primaryColor);
    if (ev) document.title = `${ev.name} · SCHEDuling`;
    return () => { root.style.removeProperty('--brand'); document.title = 'SCHEDuling'; };
  }, [ev]);

  if (q.error?.status === 404) return <NotFound message="This event doesn't exist or hasn't been published yet." />;
  if (q.error) return <div className="mx-auto max-w-3xl p-6"><ErrorState error={q.error} onRetry={q.reload} /></div>;
  if (!q.data || !ev) return <div className="mx-auto max-w-5xl p-6"><ListSkeleton rows={3} /></div>;

  const tabs = [
    ['', 'Welcome', true], ['schedule', 'Schedule', true], ['speakers', 'Speakers', true],
    ['directory', 'Directory', !!user && !!q.data.membership && ev.settings?.directoryVisible !== false],
    ['my-agenda', 'My agenda', !!user], ['ticket', 'My ticket', !!user && !!q.data.membership],
  ] as const;
  return (
    <Ctx.Provider value={{ ...q, slug }}>
      <div className="border-b border-line bg-white">
        <div className="h-1.5 bg-brand" />
        {ev.branding.bannerText && <div className="bg-brand-soft px-4 py-1.5 text-center text-sm">{ev.branding.bannerText}</div>}
        <div className="mx-auto max-w-5xl px-4 pt-5">
          <h1 className="text-2xl font-bold sm:text-3xl">{ev.name}</h1>
          <p className="mt-1 text-sm text-muted">{fmtDateRange(ev.startDate, ev.endDate)}{ev.location ? ` · ${ev.location}` : ''}{!ev.published && ' · Draft (only admins can see this)'}</p>
          <nav aria-label="Event" className="-mb-px mt-4 flex gap-1 overflow-x-auto">
            {tabs.filter((t) => t[2]).map(([to, label]) => (
              <NavLink key={to} to={to} end={to === ''} className={({ isActive }) => cx('whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium', isActive ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>{label}</NavLink>
            ))}
          </nav>
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-4 py-6"><Outlet /></div>
      {ev.branding.footerText && <p className="pb-8 text-center text-sm text-muted">{ev.branding.footerText}</p>}
    </Ctx.Provider>
  );
}
