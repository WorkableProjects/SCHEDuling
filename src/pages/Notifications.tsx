import { Link } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useQuery } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { Badge, Button, EmptyState, ErrorState, ListSkeleton, PageHeader } from '../ui/kit';

type N = { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };
const tone: Record<string, 'brand' | 'warn' | 'ok' | 'bad' | 'neutral'> = { announcement: 'brand', session_change: 'warn', session_cancelled: 'bad', promoted: 'ok', waitlist: 'neutral', reminder: 'brand' };
const label: Record<string, string> = { announcement: 'Announcement', session_change: 'Change', session_cancelled: 'Cancelled', promoted: 'Spot opened', waitlist: 'Waitlist', reminder: 'Reminder' };

export function Notifications() {
  const q = useQuery(() => get<{ notifications: N[]; unread: number }>('/api/comms/notifications'), []);
  async function markAll() { await post('/api/comms/notifications/read', {}); await q.reload(); }
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader title="Notifications" actions={q.data?.unread ? <Button onClick={markAll}>Mark all read</Button> : undefined} />
      {q.loading && !q.data && <ListSkeleton />}
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.data && !q.data.notifications.length && <EmptyState title="You're all caught up">Announcements, schedule changes and reminders will appear here.</EmptyState>}
      <ul className="space-y-2">
        {q.data?.notifications.map((n) => (
          <li key={n.id} className={`rounded-lg border bg-white p-4 ${n.read ? 'border-line' : 'border-brand-line ring-1 ring-brand-line'}`}>
            <div className="flex items-center gap-2"><Badge tone={tone[n.kind] ?? 'neutral'}>{label[n.kind] ?? n.kind}</Badge><span className="text-xs text-muted">{fmtDateTime(n.createdAt)}</span></div>
            <p className="mt-1 font-semibold">{n.title}</p>
            {n.body && <p className="text-sm text-muted whitespace-pre-line">{n.body}</p>}
            {n.link && <Link to={n.link} onClick={() => post('/api/comms/notifications/read', { ids: [n.id] })} className="mt-1 inline-block text-sm text-brand underline">Open</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}
