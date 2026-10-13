import { useMemo, useState } from 'react';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/hooks';
import { dayKey, fmtDay, fmtDayShort, fmtTime } from '../../lib/format';
import type { Room, Session, Track } from '../../lib/types';
import { useEvent } from '../../layouts/EventLayout';
import { Check, EmptyState, ErrorState, ListSkeleton, SelectField, cx } from '../../ui/kit';
import { SessionCard, useGate } from './parts';

export function Schedule() {
  const { data, slug } = useEvent();
  const { user } = useAuth();
  const gate = useGate();
  const ev = data!.event;
  const q = useQuery(() => (gate ? Promise.resolve(null) : get<{ sessions: Session[] }>(`/api/sessions?eventId=${ev.id}`)), [ev.id, user?.id, !!gate, !!data?.membership]);
  const meta = useQuery(async () => (gate ? null : { tracks: (await get<{ tracks: Track[] }>(`/api/events/${ev.id}/tracks`)).tracks, rooms: (await get<{ rooms: Room[] }>(`/api/events/${ev.id}/rooms`)).rooms }), [ev.id, !!gate]);
  const [day, setDay] = useState<string>('all');
  const [track, setTrack] = useState('');
  const [room, setRoom] = useState('');
  const [text, setText] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const sessions = q.data?.sessions ?? [];
  const days = useMemo(() => [...new Set(sessions.map((s) => dayKey(s.startsAt, ev.tz)))].sort(), [sessions, ev.tz]);
  const shown = useMemo(() => sessions.filter((s) => {
    if (day !== 'all' && dayKey(s.startsAt, ev.tz) !== day) return false;
    if (track && !s.tracks.some((t) => t.id === track)) return false;
    if (room && s.room?.id !== room) return false;
    if (mineOnly && !(s.pinned || s.mine?.inAgenda || s.mine?.registration)) return false;
    if (text) { const n = text.toLowerCase(); if (!(s.title + ' ' + (s.description ?? '') + ' ' + s.speakers.map((p) => p.name).join(' ')).toLowerCase().includes(n)) return false; }
    return true;
  }), [sessions, day, track, room, text, mineOnly, ev.tz]);

  if (gate) return gate;
  const groups = new Map<string, Session[]>();
  for (const s of shown) { const k = `${dayKey(s.startsAt, ev.tz)}|${fmtTime(s.startsAt, ev.tz)}`; groups.set(k, [...(groups.get(k) ?? []), s]); }
  let lastDay = '';
  return (
    <div>
      <div role="tablist" aria-label="Day" className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {['all', ...days].map((d) => (
          <button key={d} role="tab" aria-selected={day === d} onClick={() => setDay(d)} className={cx('whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium', day === d ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-white hover:bg-canvas')}>
            {d === 'all' ? 'All days' : fmtDayShort(`${d}T12:00:00Z`, 'UTC')}
          </button>
        ))}
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_11rem_11rem_auto] sm:items-end">
        <div className="flex flex-col gap-1"><label htmlFor="sq" className="text-sm font-medium">Search</label>
          <input id="sq" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Title, speaker or keyword" className="min-h-10 rounded-md border border-line bg-white px-3" /></div>
        <SelectField label="Track" value={track} onChange={(e) => setTrack(e.target.value)}><option value="">All tracks</option>{meta.data?.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField>
        <SelectField label="Room" value={room} onChange={(e) => setRoom(e.target.value)}><option value="">All rooms</option>{meta.data?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectField>
        {user && <div className="pb-2"><Check label="My sessions" checked={mineOnly} onChange={setMineOnly} /></div>}
      </div>
      {q.loading && !q.data && <ListSkeleton />}
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.data && !sessions.length && <EmptyState title="The schedule isn't published yet">Sessions will appear here as soon as the organizers publish them.</EmptyState>}
      {q.data && sessions.length > 0 && !shown.length && <EmptyState title="No sessions match your filters" action={<button className="text-sm text-brand underline" onClick={() => { setDay('all'); setTrack(''); setRoom(''); setText(''); setMineOnly(false); }}>Clear filters</button>} />}
      <div className="space-y-5">
        {[...groups].map(([key, list]) => {
          const [dk, time] = key.split('|') as [string, string];
          const header = dk !== lastDay ? (lastDay = dk, <h2 key={dk} className="pt-2 text-lg font-bold">{fmtDay(list[0]!.startsAt, ev.tz)}</h2>) : null;
          return (
            <div key={key}>
              {header}
              <div className="mt-2 grid gap-2 sm:grid-cols-[5.5rem_1fr]">
                <p className="pt-1 text-sm font-semibold text-muted tnum">{time}</p>
                <div className="space-y-2">{list.map((s) => <SessionCard key={s.id} s={s} tz={ev.tz} slug={slug} onChange={q.reload} others={sessions} />)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
