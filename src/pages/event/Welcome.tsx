import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { useEvent } from '../../layouts/EventLayout';
import { Badge, Button, EmptyState, LinkButton, Notice, TextField, useToast } from '../../ui/kit';

export function Welcome() {
  const { data, reload, slug } = useEvent();
  const { user } = useAuth();
  const loc = useLocation();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ev = data!.event;
  const canView = data!.canView;
  const ann = useQuery(() => (canView ? get<{ announcements: { id: string; title: string; body: string; createdAt: string }[] }>(`/api/comms/announcements?eventId=${ev.id}`) : Promise.resolve({ announcements: [] })), [ev.id, canView]);

  async function unlock(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post(`/api/events/${slug}/unlock`, { password: pw }); await reload(); } catch (x) { setErr(x instanceof Error ? x.message : 'Failed'); } finally { setBusy(false); }
  }
  async function join() {
    setBusy(true);
    try { await post(`/api/events/${slug}/join`); toast.ok("You're in! Build your agenda from the schedule."); await reload(); } catch (x) { toast.error(x); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        {ev.description ? <p className="whitespace-pre-line text-[15px] leading-relaxed">{ev.description}</p> : <p className="text-muted">No description yet.</p>}
        {canView && (
          <section aria-labelledby="ann-h">
            <h2 id="ann-h" className="mb-2 font-semibold">Announcements</h2>
            {ann.data?.announcements.length ? (
              <ul className="space-y-2">{ann.data.announcements.map((a) => (
                <li key={a.id} className="rounded-lg border border-line bg-white p-4"><p className="font-semibold">{a.title}</p><p className="whitespace-pre-line text-sm">{a.body}</p><p className="mt-1 text-xs text-muted">{fmtDateTime(a.createdAt)}</p></li>
              ))}</ul>
            ) : <EmptyState title="No announcements yet">Updates from the organizers will appear here.</EmptyState>}
          </section>
        )}
      </div>

      <aside className="space-y-3" aria-label="Access">
        {!canView && ev.privacy === 'password' && (
          <form onSubmit={unlock} className="space-y-3 rounded-lg border border-line bg-white p-4">
            <p className="font-semibold">This event is password protected</p>
            {err && <Notice tone="bad">{err}</Notice>}
            <TextField label="Event password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <Button type="submit" variant="primary" busy={busy} className="w-full">Unlock</Button>
          </form>
        )}
        {!canView && ev.privacy === 'invite_only' && (
          <Notice tone="warn"><strong>Invite-only.</strong> {user ? "Your account isn't on the guest list. Ask the organizers to invite " + user.email + '.' : 'Sign in with the email address you were invited with.'}</Notice>
        )}
        {canView && !user && (
          <div className="space-y-2 rounded-lg border border-line bg-white p-4">
            <p className="font-semibold">Join this event</p>
            <p className="text-sm text-muted">Create a free account to build your agenda and register for sessions.</p>
            <LinkButton to={`/signup?next=${encodeURIComponent(loc.pathname)}`} variant="primary" className="w-full">Sign up</LinkButton>
            <LinkButton to={`/login?next=${encodeURIComponent(loc.pathname)}`} className="w-full">Sign in</LinkButton>
          </div>
        )}
        {canView && user && !data!.membership && user.role !== 'checkin_staff' && (
          <div className="space-y-2 rounded-lg border border-line bg-white p-4">
            <p className="font-semibold">Join this event</p>
            <p className="text-sm text-muted">Joining gives you a personal agenda, session registration and a check-in ticket.</p>
            <Button variant="primary" busy={busy} onClick={join} className="w-full">Join event</Button>
          </div>
        )}
        {data!.membership && (
          <div className="space-y-2 rounded-lg border border-line bg-white p-4">
            <p className="flex items-center gap-2 font-semibold">You're registered <Badge tone="ok">{data!.membership.ticketType}</Badge></p>
            {data!.membership.checkedInAt && <p className="text-sm text-ok">Checked in ✓</p>}
            <LinkButton to="schedule" variant="primary" className="w-full">Browse schedule</LinkButton>
            <LinkButton to="ticket" className="w-full">Show my ticket</LinkButton>
          </div>
        )}
        {canView && <LinkButton to="speakers" className="w-full">Meet the speakers</LinkButton>}
        {user?.role === 'admin' && <Link to={`/admin/events/${ev.id}`} className="block text-center text-sm text-brand underline">Manage this event</Link>}
      </aside>
    </div>
  );
}
