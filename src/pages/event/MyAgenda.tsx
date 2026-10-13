import { Link } from 'react-router-dom';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/hooks';
import { dayKey, fmtDay, overlaps } from '../../lib/format';
import type { Session } from '../../lib/types';
import { useEvent } from '../../layouts/EventLayout';
import { CopyLink, EmptyState, ErrorState, LinkButton, ListSkeleton, Notice } from '../../ui/kit';
import { SessionCard, useGate } from './parts';
import { Navigate } from 'react-router-dom';

export function MyAgenda() {
  const { data, slug } = useEvent();
  const { user, loading } = useAuth();
  const gate = useGate();
  const ev = data!.event;
  const q = useQuery(() => (gate || !user ? Promise.resolve(null) : get<{ sessions: Session[] }>(`/api/agenda?eventId=${ev.id}`)), [ev.id, user?.id, !!gate]);
  const ical = useQuery(() => (user ? get<{ icalToken: string }>('/api/auth/ical-token') : Promise.resolve(null)), [user?.id]);
  if (gate) return gate;
  if (!loading && !user) return <Navigate to={`/login?next=${encodeURIComponent(`/e/${slug}/my-agenda`)}`} replace />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const sessions = q.data.sessions;
  const byDay = new Map<string, Session[]>();
  for (const s of sessions) byDay.set(dayKey(s.startsAt, ev.tz), [...(byDay.get(dayKey(s.startsAt, ev.tz)) ?? []), s]);
  const clashes = sessions.filter((a) => a.status !== 'cancelled' && sessions.some((b) => b.id !== a.id && b.status !== 'cancelled' && overlaps(a, b)));
  return (
    <div className="space-y-5">
      {!data!.membership && <Notice tone="warn">Join the event from the <Link to={`/e/${slug}`} className="underline">welcome page</Link> to add sessions to your agenda.</Notice>}
      {clashes.length > 0 && <Notice tone="warn">{clashes.length} sessions on your agenda overlap in time. Check the highlighted days below.</Notice>}
      {ical.data && <CopyLink label="Calendar feed" link={`${location.origin}/api/ical/${ical.data.icalToken}.ics`} />}
      {!sessions.length && <EmptyState title="Your agenda is empty" action={<LinkButton to={`/e/${slug}/schedule`} variant="primary">Browse the schedule</LinkButton>}>Add sessions with “+ Agenda”. Sessions marked <em>Registration</em> need you to register to hold a seat.</EmptyState>}
      {[...byDay].map(([k, list]) => (
        <section key={k}>
          <h2 className="mb-2 text-lg font-bold">{fmtDay(list[0]!.startsAt, ev.tz)}</h2>
          <div className="space-y-2">{list.map((s) => (
            <div key={s.id} className={clashes.includes(s) ? 'rounded-lg ring-2 ring-amber-300' : ''}><SessionCard s={s} tz={ev.tz} slug={slug} onChange={q.reload} others={sessions} /></div>
          ))}</div>
        </section>
      ))}
    </div>
  );
}
