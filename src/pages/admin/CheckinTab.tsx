import { get } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { fmtTime, fmtDayShort } from '../../lib/format';
import { CopyLink, ErrorState, LinkButton, ListSkeleton, Notice, PageHeader } from '../../ui/kit';
import { useAdminEvent } from './EventLayout';

const btn = 'inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3.5 text-sm font-medium hover:bg-canvas';
export function CheckinTab() {
  const { ev } = useAdminEvent();
  const q = useQuery(() => get<{ members: number; checkedIn: number; sessions: { id: string; title: string; startsAt: string; registered: number; capacity: number | null; checkedIn: number }[] }>(`/api/checkin/${ev.id}/stats`), [ev.id]);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const d = q.data;
  const pct = d.members ? Math.round((d.checkedIn / d.members) * 100) : 0;
  return (
    <>
      <PageHeader title="Check-in" sub="Scan QR tickets, check people in by name, or let attendees check themselves in." actions={<><LinkButton to={`/checkin/${ev.slug}`} variant="primary">Open check-in app</LinkButton><LinkButton to={`/admin/events/${ev.id}/badges`}>Print badges</LinkButton></>} />
      <div className="mb-6 rounded-lg border border-line bg-white p-5">
        <p className="text-sm text-muted">Event check-in</p>
        <p className="text-3xl font-bold tnum">{d.checkedIn} <span className="text-lg font-normal text-muted">of {d.members} · {pct}%</span></p>
        <div className="mt-2 h-2.5 overflow-hidden rounded bg-slate-100"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="mb-6 space-y-2"><p className="text-sm font-medium">Give volunteers the scanner</p><CopyLink label="Check-in app" link={`${location.origin}/checkin/${ev.slug}`} />
        <Notice>Volunteers sign in with a <strong>check-in staff</strong> account (create one under Users & admins). Staff can scan and search, but can't see reports or change anything else, so they don't use up an admin seat.</Notice></div>
      <h2 className="mb-2 font-semibold">Exports</h2>
      <div className="mb-6 flex flex-wrap gap-2">
        <a className={btn} href={`/api/reports/event/${ev.id}/export/attendees`}>Event attendance (CSV)</a>
        <a className={btn} href={`/api/reports/event/${ev.id}/export/checkins`}>Session attendance (CSV)</a>
        <a className={btn} href={`/api/reports/event/${ev.id}/export/sessions`}>Session counts (CSV)</a>
      </div>
      <h2 className="mb-2 font-semibold">By session</h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-white"><table className="w-full text-sm"><thead className="border-b border-line bg-canvas text-left text-xs uppercase text-muted"><tr><th className="px-3 py-2">Session</th><th className="px-3 py-2">Registered</th><th className="px-3 py-2">Checked in</th></tr></thead>
        <tbody className="divide-y divide-line">{d.sessions.map((s) => <tr key={s.id}><td className="px-3 py-2"><span className="font-medium">{s.title}</span><span className="block text-xs text-muted">{fmtDayShort(s.startsAt, ev.tz)} {fmtTime(s.startsAt, ev.tz)}</span></td><td className="px-3 py-2 tnum">{s.registered}{s.capacity ? ` / ${s.capacity}` : ''}</td><td className="px-3 py-2 tnum">{s.checkedIn}</td></tr>)}
          {!d.sessions.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">No published sessions.</td></tr>}</tbody></table></div>
    </>
  );
}
