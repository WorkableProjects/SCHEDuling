import { get } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { Badge, DataTable, ErrorState, ListSkeleton, PageHeader } from '../../ui/kit';
import { useAdminEvent } from './EventLayout';

type S = { id: string; title: string; registered: number; waitlisted: number; capacity: number | null; checkedIn: number; agendaCount: number; noShows: number | null; capacityUse: number | null; rating: number | null; ratings: number };
const btn = 'inline-flex min-h-10 items-center rounded-md border border-line bg-white px-3.5 text-sm font-medium hover:bg-canvas';

export function ReportsTab() {
  const { ev } = useAdminEvent();
  const q = useQuery(() => get<{ members: number; checkedIn: number; noShows: number; sessions: S[] }>(`/api/reports/event/${ev.id}/summary`), [ev.id]);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const d = q.data;
  return (
    <>
      <PageHeader title="Reports" sub="Popularity, capacity use, no-shows and feedback by session." actions={<>
        {['attendees', 'registrations', 'checkins', 'sessions', 'feedback'].map((k) => <a key={k} className={btn} href={`/api/reports/event/${ev.id}/export/${k}`}>Export {k} (CSV)</a>)}</>} />
      <dl className="mb-6 grid grid-cols-3 gap-3 max-w-xl">{[['People', d.members], ['Checked in', d.checkedIn], ['No-shows', d.noShows]].map(([k, v]) => <div key={k} className="rounded-lg border border-line bg-white px-4 py-3"><dt className="text-xs uppercase tracking-wide text-muted">{k}</dt><dd className="text-2xl font-bold tnum">{v}</dd></div>)}</dl>
      <DataTable rows={d.sessions} rowKey={(s) => s.id} empty="No published sessions yet."
        columns={[
          { key: 't', header: 'Session', sort: (a, b) => a.title.localeCompare(b.title), render: (s) => <span className="font-medium">{s.title}</span> },
          { key: 'ag', header: 'On agendas', className: 'tnum', sort: (a, b) => a.agendaCount - b.agendaCount, render: (s) => s.agendaCount },
          { key: 'rg', header: 'Registered', className: 'tnum', sort: (a, b) => a.registered - b.registered, render: (s) => `${s.registered}${s.capacity ? ` / ${s.capacity}` : ''}${s.waitlisted ? ` (+${s.waitlisted} waiting)` : ''}` },
          { key: 'cu', header: 'Capacity used', className: 'tnum', render: (s) => (s.capacityUse === null ? '–' : <Badge tone={s.capacityUse >= 100 ? 'bad' : s.capacityUse >= 60 ? 'warn' : 'ok'}>{s.capacityUse}%</Badge>) },
          { key: 'ci', header: 'Attended', className: 'tnum', sort: (a, b) => a.checkedIn - b.checkedIn, render: (s) => s.checkedIn },
          { key: 'ns', header: 'No-shows', className: 'tnum', render: (s) => s.noShows ?? '–' },
          { key: 'fb', header: 'Rating', className: 'tnum', sort: (a, b) => (a.rating ?? 0) - (b.rating ?? 0), render: (s) => (s.rating ? `${s.rating} ★ (${s.ratings})` : '–') },
        ]} />
    </>
  );
}
