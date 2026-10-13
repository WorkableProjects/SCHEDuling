import { useState } from 'react';
import { del, get, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { fmtDayShort, fmtTime, fmtDateTime } from '../../lib/format';
import type { Session } from '../../lib/types';
import { Badge, Button, DataTable, EmptyState, ErrorState, ListSkeleton, PageHeader, SelectField, useToast } from '../../ui/kit';
import { useAdminEvent } from './EventLayout';

type Reg = { userId: string; name: string; email: string; status: 'registered' | 'waitlisted'; position: number | null; at: string; checkedInAt: string | null };
type A = { userId: string; name: string; email: string };

export function RegistrationsTab() {
  const { ev } = useAdminEvent();
  const toast = useToast();
  const base = useQuery(async () => ({ sessions: (await get<{ sessions: Session[] }>(`/api/sessions?eventId=${ev.id}`)).sessions.filter((s) => s.requiresRegistration), people: (await get<{ attendees: A[] }>(`/api/people/attendees?eventId=${ev.id}`)).attendees }), [ev.id]);
  const [sid, setSid] = useState('');
  const [who, setWho] = useState('');
  const regs = useQuery(() => (sid ? get<{ registrations: Reg[] }>(`/api/sessions/${sid}/registrations`) : Promise.resolve({ registrations: [] as Reg[] })), [sid]);
  if (base.error) return <ErrorState error={base.error} onRetry={base.reload} />;
  if (!base.data) return <ListSkeleton />;
  const s = base.data.sessions.find((x) => x.id === sid);
  async function enroll() { try { const r = await post(`/api/sessions/${sid}/enroll`, { userId: who }); toast.ok(r.status === 'waitlisted' ? 'Session is full: added to the waitlist' : 'Enrolled'); setWho(''); await Promise.all([regs.reload(), base.reload()]); } catch (e) { toast.error(e); } }
  return (
    <>
      <PageHeader title="Registrations" sub="Seats, waitlists and manual enrolment for sessions that require registration." actions={<a className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3.5 text-sm font-medium hover:bg-canvas" href={`/api/reports/event/${ev.id}/export/registrations`}>Export all (CSV)</a>} />
      {!base.data.sessions.length ? <EmptyState title="No sessions require registration">Turn on “Requires registration” when editing a session to enforce capacity and a waitlist.</EmptyState> : <>
        <SelectField className="mb-4 max-w-lg" label="Session" value={sid} onChange={(e) => setSid(e.target.value)}>
          <option value="">Choose a session…</option>
          {base.data.sessions.map((x) => <option key={x.id} value={x.id}>{fmtDayShort(x.startsAt, ev.tz)} {fmtTime(x.startsAt, ev.tz)} · {x.title} ({x.registeredCount ?? 0}{x.capacity ? `/${x.capacity}` : ''})</option>)}
        </SelectField>
        {sid && s && <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <SelectField className="min-w-64" label="Enroll someone (admins bypass freezes and conflicts)" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose attendee…</option>{base.data.people.map((p) => <option key={p.userId} value={p.userId}>{p.name} ({p.email})</option>)}</SelectField>
            <Button variant="primary" disabled={!who} onClick={enroll}>Enroll</Button>
          </div>
          <DataTable rows={regs.data?.registrations ?? []} rowKey={(r) => r.userId} empty="Nobody has registered yet."
            columns={[
              { key: 'n', header: 'Name', render: (r) => <><span className="font-medium">{r.name}</span><span className="block text-xs text-muted">{r.email}</span></> },
              { key: 's', header: 'Status', render: (r) => (r.status === 'registered' ? <Badge tone="ok">Registered</Badge> : <Badge tone="warn">Waitlist #{r.position}</Badge>) },
              { key: 'at', header: 'Since', render: (r) => fmtDateTime(r.at) },
              { key: 'ci', header: 'Attended', render: (r) => (r.checkedInAt ? <Badge tone="ok">Checked in</Badge> : '–') },
              { key: 'a', header: '', render: (r) => <Button small variant="danger" onClick={async () => { await del(`/api/sessions/${sid}/enroll/${r.userId}`); await Promise.all([regs.reload(), base.reload()]); }}>Remove</Button> },
            ]} />
        </>}
      </>}
    </>
  );
}
