import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { del, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtTime } from '../../lib/format';
import type { Session } from '../../lib/types';
import { Badge, Button, Notice, useToast } from '../../ui/kit';
import { useEvent } from '../../layouts/EventLayout';

const capTone = { open: 'ok', filling: 'warn', nearly_full: 'warn', full: 'bad' } as const;
const capText = { open: 'Open', filling: 'Filling up', nearly_full: 'Nearly full', full: 'Full' } as const;

export function CapacityBadge({ s }: { s: Session }) {
  if (!s.capacityLabel) return null;
  return <Badge tone={capTone[s.capacityLabel]}>{capText[s.capacityLabel]}{s.registeredCount !== undefined && s.capacity ? ` · ${s.registeredCount}/${s.capacity}` : ''}</Badge>;
}

/** Shown on tabs that need a visible event. */
export function useGate(): ReactNode | null {
  const { data, slug } = useEvent();
  if (!data || data.canView) return null;
  return (
    <Notice tone="warn">
      This event is {data.event.privacy === 'password' ? 'password protected' : 'invite-only'}.{' '}
      <Link className="underline" to={`/e/${slug}`}>{data.event.privacy === 'password' ? 'Enter the password' : 'See how to get access'}</Link>.
    </Notice>
  );
}

/**
 * Agenda vs registration are separate on purpose: adding to your agenda is a bookmark; registering reserves
 * a seat (capacity, waitlist, conflicts, attendance).
 */
export function SessionActions({ s, onChange, others }: { s: Session; onChange: () => void | Promise<void>; others?: Session[] }) {
  const { user } = useAuth();
  const { data, slug } = useEvent();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const member = !!data?.membership;
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast.ok(ok); await onChange(); } catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  if (s.status === 'cancelled') return <Badge tone="bad">Cancelled</Badge>;
  if (!user) return <Link className="text-sm text-brand underline" to={`/login?next=${encodeURIComponent(`/e/${slug}/schedule`)}`}>Sign in to plan</Link>;
  if (!member) return <Link className="text-sm text-brand underline" to={`/e/${slug}`}>Join event to plan</Link>;

  const m = s.mine;
  const frozen = s.frozen;
  const clash = !m?.registration && s.requiresRegistration && !data?.event.settings?.allowConflicts
    ? others?.find((o) => o.id !== s.id && o.mine?.registration === 'registered' && o.startsAt < s.endsAt && o.endsAt > s.startsAt) : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {s.pinned ? <Badge tone="brand">Pinned</Badge> : m?.inAgenda ? (
        <Button small disabled={frozen || m.registration !== null} busy={busy === 'agenda'} aria-label={`Remove ${s.title} from agenda`}
          title={m.registration ? 'Cancel your registration to remove this' : undefined}
          onClick={() => run('agenda', () => del(`/api/agenda/${s.id}`), 'Removed from your agenda')}>✓ In agenda</Button>
      ) : (
        <Button small disabled={frozen} busy={busy === 'agenda'} aria-label={`Add ${s.title} to agenda`} onClick={() => run('agenda', () => post(`/api/agenda/${s.id}`), 'Added to your agenda')}>+ Agenda</Button>
      )}
      {s.requiresRegistration && (
        m?.registration === 'registered' ? (
          <><Badge tone="ok">Registered</Badge><Button small variant="ghost" disabled={frozen} busy={busy === 'reg'} onClick={() => run('reg', () => del(`/api/sessions/${s.id}/register`), 'Registration cancelled')}>Cancel</Button></>
        ) : m?.registration === 'waitlisted' ? (
          <><Badge tone="warn">Waitlist #{m.position}</Badge><Button small variant="ghost" disabled={frozen} busy={busy === 'reg'} onClick={() => run('reg', () => del(`/api/sessions/${s.id}/register`), 'Left the waitlist')}>Leave</Button></>
        ) : (
          <Button small variant="primary" disabled={frozen || !!clash} busy={busy === 'reg'} title={clash ? `Overlaps with ${clash.title}` : undefined}
            onClick={() => run('reg', async () => { const r = await post(`/api/sessions/${s.id}/register`); toast.ok(r.status === 'waitlisted' ? `Session is full: you're #${r.position} on the waitlist` : 'You are registered'); })}>
            {s.capacityLabel === 'full' ? 'Join waitlist' : 'Register'}
          </Button>
        )
      )}
      {frozen && <Badge>Frozen</Badge>}
      {clash && <span className="text-xs text-warn">Overlaps “{clash.title}”</span>}
    </div>
  );
}

export function SessionCard({ s, tz, slug, onChange, others }: { s: Session; tz: string; slug: string; onChange: () => void | Promise<void>; others?: Session[] }) {
  return (
    <article className={`rounded-lg border bg-white p-4 ${s.status === 'cancelled' ? 'border-red-200 opacity-75' : 'border-line'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-muted tnum">{fmtTime(s.startsAt, tz)} – {fmtTime(s.endsAt, tz)}{s.room ? ` · ${s.room.name}` : ''}</p>
          <h3 className="mt-0.5 text-base font-semibold"><Link to={`/e/${slug}/session/${s.id}`} className={`hover:text-brand hover:underline ${s.status === 'cancelled' ? 'line-through' : ''}`}>{s.title}</Link></h3>
          {s.speakers.length > 0 && <p className="text-sm text-muted">{s.speakers.map((p, i) => <span key={p.id}>{i > 0 && ', '}<Link to={`/e/${slug}/speaker/${p.id}`} className="hover:underline">{p.name}</Link></span>)}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.tracks.map((t) => <span key={t.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs"><span aria-hidden className="size-2 rounded-full" style={{ background: t.color }} />{t.name}</span>)}
            {s.requiresRegistration && <Badge tone="brand">Registration</Badge>}
            <CapacityBadge s={s} />
            {s.mine?.checkedIn && <Badge tone="ok">Checked in</Badge>}
          </div>
        </div>
        <SessionActions s={s} onChange={onChange} others={others} />
      </div>
    </article>
  );
}
