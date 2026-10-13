import { Link } from 'react-router-dom';
import { get } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { fmtDateRange } from '../lib/format';
import { Badge, EmptyState, ErrorState, LinkButton, ListSkeleton } from '../ui/kit';

type Ev = { id: string; slug: string; name: string; description: string | null; startDate: string; endDate: string; location: string | null; privacy: string; published: boolean; archived: boolean; isMember: boolean };

export function Home() {
  const { user } = useAuth();
  const q = useQuery(() => get<{ events: Ev[] }>('/api/events'), [user?.id]);
  const events = (q.data?.events ?? []).filter((e) => e.published && !e.archived);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.endDate >= today);
  const past = events.filter((e) => e.endDate < today);
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold">Events</h1>
      <p className="mt-1 text-muted">Browse the schedule, build your agenda, and check in on the day.</p>
      <div className="mt-6 space-y-8">
        {q.loading && !q.data && <ListSkeleton />}
        {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
        {q.data && !events.length && (
          <EmptyState title="No events yet" action={user?.role === 'admin' ? <LinkButton to="/admin/events/new" variant="primary">Create the first event</LinkButton> : undefined}>
            {user?.role === 'admin' ? 'Create and publish an event to see it here.' : 'Published events will show up here. If you were invited to a private event, sign in with the invited email.'}
          </EmptyState>
        )}
        {upcoming.length > 0 && <EventList title="Upcoming and current" events={upcoming} />}
        {past.length > 0 && <EventList title="Past events" events={past} />}
      </div>
    </div>
  );
}

function EventList({ title, events }: { title: string; events: Ev[] }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
        {events.map((e) => (
          <li key={e.id}>
            <Link to={`/e/${e.slug}`} className="flex items-start justify-between gap-4 px-4 py-4 hover:bg-canvas">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{e.name}</p>
                <p className="text-sm text-muted">{fmtDateRange(e.startDate, e.endDate)}{e.location ? ` · ${e.location}` : ''}</p>
                {e.description && <p className="mt-1 line-clamp-2 text-sm">{e.description}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {e.isMember && <Badge tone="ok">You're in</Badge>}
                {e.privacy === 'password' && <Badge>Password</Badge>}
                {e.privacy === 'invite_only' && <Badge>Invite-only</Badge>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
