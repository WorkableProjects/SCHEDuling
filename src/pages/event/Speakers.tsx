import { Link, useParams } from 'react-router-dom';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/hooks';
import { fmtDayShort, fmtTime } from '../../lib/format';
import { useEvent } from '../../layouts/EventLayout';
import { Avatar, EmptyState, ErrorState, ListSkeleton } from '../../ui/kit';
import { useGate } from './parts';

type Speaker = { id: string; name: string; title: string | null; org: string | null; bio: string | null; hasPhoto: boolean; sessions: { id: string; title: string; startsAt: string; status: string }[] };

export function Speakers() {
  const { id } = useParams();
  const { data, slug } = useEvent();
  const { user } = useAuth();
  const gate = useGate();
  const ev = data!.event;
  const q = useQuery(() => (gate ? Promise.resolve(null) : get<{ speakers: Speaker[] }>(`/api/people/speakers?eventId=${ev.id}`)), [ev.id, user?.id, !!gate]);
  if (gate) return gate;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const list = q.data.speakers;
  if (id) {
    const p = list.find((x) => x.id === id);
    if (!p) return <EmptyState title="Speaker not found" action={<Link className="text-brand underline" to={`/e/${slug}/speakers`}>All speakers</Link>} />;
    return (
      <div className="max-w-2xl space-y-4">
        <Link to={`/e/${slug}/speakers`} className="text-sm text-brand hover:underline">← All speakers</Link>
        <div className="flex items-center gap-4"><Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={88} /><div><h2 className="text-2xl font-bold">{p.name}</h2><p className="text-muted">{[p.title, p.org].filter(Boolean).join(', ')}</p></div></div>
        {p.bio && <p className="whitespace-pre-line leading-relaxed">{p.bio}</p>}
        <h3 className="font-semibold">Sessions</h3>
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {p.sessions.map((s) => <li key={s.id}><Link className="block px-4 py-3 hover:bg-canvas" to={`/e/${slug}/session/${s.id}`}><span className="font-medium">{s.title}</span><span className="block text-sm text-muted">{fmtDayShort(s.startsAt, ev.tz)} · {fmtTime(s.startsAt, ev.tz)}</span></Link></li>)}
          {!p.sessions.length && <li className="px-4 py-3 text-sm text-muted">No published sessions yet.</li>}
        </ul>
      </div>
    );
  }
  if (!list.length) return <EmptyState title="No speakers yet">Speaker profiles will appear here once they're added.</EmptyState>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((p) => (
        <li key={p.id}><Link to={`/e/${slug}/speaker/${p.id}`} className="flex h-full items-center gap-3 rounded-lg border border-line bg-white p-3.5 hover:bg-canvas">
          <Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={52} />
          <span className="min-w-0"><span className="block font-semibold">{p.name}</span><span className="block truncate text-sm text-muted">{[p.title, p.org].filter(Boolean).join(', ') || `${p.sessions.length} session${p.sessions.length === 1 ? '' : 's'}`}</span></span>
        </Link></li>
      ))}
    </ul>
  );
}
