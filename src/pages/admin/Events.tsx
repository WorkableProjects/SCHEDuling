import { Link, useNavigate } from 'react-router-dom';
import { get, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { fmtDateRange } from '../../lib/format';
import { Badge, DataTable, ErrorState, LinkButton, ListSkeleton, PageHeader, useToast } from '../../ui/kit';
import { EventForm } from './EventForm';

type Ev = { id: string; slug: string; name: string; startDate: string; endDate: string; privacy: string; published: boolean; archived: boolean; sessions?: number; members?: number };

export function EventsList() {
  const q = useQuery(() => get<{ events: Ev[] }>('/api/events'), []);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  return (
    <>
      <PageHeader title="Events" actions={<LinkButton to="/admin/events/new" variant="primary">New event</LinkButton>} />
      <DataTable rows={q.data.events} rowKey={(e) => e.id} searchText={(e) => `${e.name} ${e.slug}`} searchPlaceholder="Search events" empty="No events yet."
        columns={[
          { key: 'name', header: 'Event', sort: (a, b) => a.name.localeCompare(b.name), render: (e) => <><Link to={`/admin/events/${e.id}`} className="font-medium text-brand hover:underline">{e.name}</Link><span className="block text-xs text-muted">/e/{e.slug}</span></> },
          { key: 'dates', header: 'Dates', sort: (a, b) => a.startDate.localeCompare(b.startDate), render: (e) => fmtDateRange(e.startDate, e.endDate) },
          { key: 'privacy', header: 'Access', render: (e) => ({ public: 'Public', invite_only: 'Invite-only', password: 'Password' }[e.privacy]) },
          { key: 'status', header: 'Status', render: (e) => (e.archived ? <Badge>Archived</Badge> : e.published ? <Badge tone="ok">Published</Badge> : <Badge tone="warn">Draft</Badge>) },
          { key: 'sessions', header: 'Sessions', className: 'tnum', render: (e) => e.sessions ?? 0 },
          { key: 'members', header: 'People', className: 'tnum', render: (e) => e.members ?? 0 },
        ]} />
    </>
  );
}

export function EventCreate() {
  const nav = useNavigate();
  const toast = useToast();
  return (
    <>
      <PageHeader title="New event" sub="Choose a URL, dates and who can see it. You can publish when the schedule is ready." />
      <EventForm onSave={async (body) => { const r = await post('/api/events', body); toast.ok('Event created'); nav(`/admin/events/${r.event.id}`); }} submitLabel="Create event" creating />
    </>
  );
}
