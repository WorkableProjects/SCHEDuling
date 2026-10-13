import { Link } from 'react-router-dom';
import { get } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { fmtDateRange } from '../../lib/format';
import { Badge, DataTable, ErrorState, LinkButton, ListSkeleton, PageHeader } from '../../ui/kit';

type Row = { id: string; slug: string; name: string; startDate: string; endDate: string; published: boolean; archived: boolean; members: number; checkedIn: number; sessions: number; registrations: number };

export function Dashboard() {
  const q = useQuery(() => get<{ users: number; admins: number; events: Row[] }>('/api/reports/dashboard'), []);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const d = q.data;
  const totals = d.events.reduce((a, e) => ({ members: a.members + e.members, checked: a.checked + e.checkedIn, sessions: a.sessions + e.sessions }), { members: 0, checked: 0, sessions: 0 });
  const stats: [string, string | number][] = [['Events', d.events.length], ['Sessions', totals.sessions], ['Attendees & speakers', totals.members], ['Checked in', totals.members ? `${Math.round((totals.checked / totals.members) * 100)}%` : '–'], ['Admin seats', `${d.admins} / 2`]];
  return (
    <>
      <PageHeader title="Dashboard" actions={<LinkButton to="/admin/events/new" variant="primary">New event</LinkButton>} />
      <dl className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map(([k, v]) => <div key={k} className="rounded-lg border border-line bg-white px-4 py-3"><dt className="text-xs uppercase tracking-wide text-muted">{k}</dt><dd className="text-2xl font-bold tnum">{v}</dd></div>)}
      </dl>
      <h2 className="mb-2 font-semibold">Events</h2>
      <DataTable rows={d.events} rowKey={(e) => e.id} empty="No events yet. Create your first one."
        columns={[
          { key: 'name', header: 'Event', sort: (a, b) => a.name.localeCompare(b.name), render: (e) => <Link to={`/admin/events/${e.id}`} className="font-medium text-brand hover:underline">{e.name}</Link> },
          { key: 'dates', header: 'Dates', render: (e) => fmtDateRange(e.startDate, e.endDate) },
          { key: 'status', header: 'Status', render: (e) => (e.archived ? <Badge>Archived</Badge> : e.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>) },
          { key: 'sessions', header: 'Sessions', className: 'tnum', render: (e) => e.sessions },
          { key: 'members', header: 'People', className: 'tnum', render: (e) => e.members },
          { key: 'regs', header: 'Registrations', className: 'tnum', render: (e) => e.registrations },
          { key: 'ci', header: 'Check-in rate', className: 'tnum', render: (e) => (e.members ? `${e.checkedIn}/${e.members} (${Math.round((e.checkedIn / e.members) * 100)}%)` : '–') },
        ]} />
    </>
  );
}
