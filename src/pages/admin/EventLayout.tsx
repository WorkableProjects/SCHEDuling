import { createContext, useContext, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { del, get, patch, post } from '../../lib/api';
import { useQuery, type Query } from '../../lib/hooks';
import { fmtDateRange } from '../../lib/format';
import { Badge, Button, CopyLink, Dialog, ErrorState, ListSkeleton, TextField, cx, useConfirm, useToast } from '../../ui/kit';
import { EventForm, type EventDto } from './EventForm';

export type AdminEvent = EventDto & { id: string; published: boolean; archived: boolean };
const Ctx = createContext<Query<{ event: AdminEvent }>>(null as never);
export const useAdminEvent = () => { const q = useContext(Ctx); return { ...q, ev: q.data!.event }; };

const tabs = [['', 'Settings'], ['sessions', 'Sessions'], ['structure', 'Tracks & rooms'], ['people', 'Speakers & attendees'], ['registrations', 'Registrations'], ['checkin', 'Check-in'], ['announcements', 'Announcements'], ['reports', 'Reports']] as const;

export function AdminEventLayout() {
  const { id = '' } = useParams();
  const q = useQuery(() => get<{ event: AdminEvent }>(`/api/events/${id}`).then((r) => ({ event: { ...r.event, id: r.event.id } })), [id]);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const ev = q.data.event;
  return (
    <Ctx.Provider value={q}>
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">{ev.name}</h1>{ev.archived ? <Badge>Archived</Badge> : ev.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>}</div>
        <p className="text-sm text-muted">{fmtDateRange(ev.startDate, ev.endDate)} · <a className="text-brand underline" href={`/e/${ev.slug}`} target="_blank" rel="noreferrer">/e/{ev.slug}</a></p>
      </div>
      <nav aria-label="Event sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([to, label]) => <NavLink key={to} to={to} end={to === ''} className={({ isActive }) => cx('whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium', isActive ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>{label}</NavLink>)}
      </nav>
      <Outlet />
    </Ctx.Provider>
  );
}

export function EventSettingsTab() {
  const { ev, reload } = useAdminEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [dup, setDup] = useState(false);
  const [d, setD] = useState({ slug: `${ev.slug}-copy`, name: `${ev.name} (copy)`, startDate: ev.startDate });
  async function act(action: string, ok: string) { try { await post(`/api/events/${ev.id}/${action}`); toast.ok(ok); await reload(); } catch (e) { toast.error(e); } }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-4">
        {ev.published ? <Button onClick={() => act('unpublish', 'Event unpublished: only admins can see it now')}>Unpublish</Button> : <Button variant="primary" onClick={() => act('publish', 'Event published')}>Publish event</Button>}
        {ev.archived ? <Button onClick={() => act('unarchive', 'Event restored')}>Restore from archive</Button> : <Button onClick={async () => { if (await confirm({ title: 'Archive this event?', body: 'It disappears from the public list. Data and attendance history are kept.', confirm: 'Archive' })) await act('archive', 'Event archived'); }}>Archive</Button>}
        <Button onClick={() => setDup(true)}>Duplicate…</Button>
        <Button variant="danger" disabled={ev.published} title={ev.published ? 'Unpublish first' : undefined} onClick={async () => { if (await confirm({ title: 'Delete event permanently?', danger: true, confirm: 'Delete forever', body: 'This removes its sessions, registrations and attendance records. This cannot be undone. Consider archiving instead.' })) { try { await del(`/api/events/${ev.id}`); toast.ok('Event deleted'); nav('/admin/events'); } catch (e) { toast.error(e); } } }}>Delete</Button>
        <div className="basis-full"><CopyLink label="Public link" link={`${location.origin}/e/${ev.slug}`} /></div>
      </div>
      <EventForm key={ev.slug + ev.name} initial={ev} submitLabel="Save changes" onSave={async (body) => { await patch(`/api/events/${ev.id}`, body); toast.ok('Saved'); await reload(); }} />
      <Dialog open={dup} onClose={() => setDup(false)} title="Duplicate event" footer={<><Button onClick={() => setDup(false)}>Cancel</Button><Button variant="primary" onClick={async () => { try { const r = await post(`/api/events/${ev.id}/duplicate`, d); toast.ok('Copied as a draft'); setDup(false); nav(`/admin/events/${r.event.id}`); } catch (e) { toast.error(e); } }}>Duplicate</Button></>}>
        <p className="mb-3 text-sm text-muted">Copies tracks, rooms and sessions (as drafts), shifted to the new start date. People and registrations are not copied.</p>
        <div className="space-y-3"><TextField label="Name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /><TextField label="URL" value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase() })} /><TextField label="New start date" type="date" value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} /></div>
      </Dialog>
    </div>
  );
}
