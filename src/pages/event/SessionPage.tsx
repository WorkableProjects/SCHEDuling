import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, get, patch, post, del } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/hooks';
import { fmtDay, fmtTime } from '../../lib/format';
import type { Session } from '../../lib/types';
import { useEvent } from '../../layouts/EventLayout';
import { Avatar, Badge, Button, ErrorState, ListSkeleton, Notice, TextArea, useToast } from '../../ui/kit';
import { CapacityBadge, SessionActions, useGate } from './parts';
import { NotFound } from '../NotFound';

export function SessionPage() {
  const { id = '' } = useParams();
  const { data, slug } = useEvent();
  const { user } = useAuth();
  const toast = useToast();
  const gate = useGate();
  const ev = data!.event;
  const q = useQuery(() => (gate ? Promise.resolve(null) : get<{ session: Session }>(`/api/sessions/${id}`)), [id, user?.id, !!gate, !!data?.membership]);
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  if (gate) return gate;
  if (q.error?.status === 404) return <NotFound message="This session doesn't exist or isn't published." />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton rows={3} />;
  const s = q.data.session;
  const isSpeaker = !!user && s.speakers.some((p) => p.id === user.id);
  const canEdit = user?.role === 'admin' || (isSpeaker && ev.settings?.speakerEdit !== false);
  const started = new Date(s.startsAt).getTime() <= Date.now();
  const nearStart = Math.abs(Date.now() - new Date(s.startsAt).getTime()) <= 30 * 60_000;
  const joined = !!(s.mine?.inAgenda || s.mine?.registration === 'registered' || s.mine?.checkedIn);
  const canSelfCheckin = !!data!.membership && ev.settings?.selfCheckin !== false && s.status === 'published' && nearStart && (!s.requiresRegistration || s.mine?.registration === 'registered');

  async function saveDesc(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      if (user!.role === 'admin') {
        await patch(`/api/sessions/${s.id}`, { eventId: s.eventId, title: s.title, description: desc || null, startsAt: s.startsAt, endsAt: s.endsAt, roomId: s.room?.id ?? null, status: s.status, capacity: s.capacity, requiresRegistration: s.requiresRegistration, pinned: s.pinned, frozen: false, trackIds: s.tracks.map((t) => t.id), speakerIds: s.speakers.map((p) => p.id) });
      } else await patch(`/api/sessions/${s.id}`, { description: desc || null });
      toast.ok('Description saved'); setEditing(false); await q.reload();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  }
  async function upload(files: FileList | null) {
    const f = files?.[0]; if (!f) return;
    try { const fd = new FormData(); fd.set('file', f); await api('POST', `/api/sessions/${s.id}/materials`, fd); toast.ok('File uploaded'); await q.reload(); } catch (err) { toast.error(err); }
    if (file.current) file.current.value = '';
  }
  async function checkin() {
    try { const r = await post(`/api/checkin/${ev.id}/self`, { sessionId: s.id }); toast.ok(r.session?.alreadyCheckedIn ? "You're already checked in" : 'Checked in. Enjoy the session!'); await q.reload(); } catch (err) { toast.error(err); }
  }
  async function feedback(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await post(`/api/sessions/${s.id}/feedback`, { rating, comment: comment || null }); toast.ok('Thanks for the feedback!'); } catch (err) { toast.error(err); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
      <article className="min-w-0 space-y-5">
        <div>
          <Link to={`/e/${slug}/schedule`} className="text-sm text-brand hover:underline">← Schedule</Link>
          <h2 className={`mt-1 text-2xl font-bold ${s.status === 'cancelled' ? 'line-through' : ''}`}>{s.title}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.status === 'draft' && <Badge tone="warn">Draft</Badge>}
            {s.status === 'cancelled' && <Badge tone="bad">Cancelled</Badge>}
            {s.tracks.map((t) => <span key={t.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs"><span aria-hidden className="size-2 rounded-full" style={{ background: t.color }} />{t.name}</span>)}
            <CapacityBadge s={s} />
          </div>
        </div>
        <div className="rounded-lg border border-line bg-white p-4 text-sm">
          <p className="font-semibold">{fmtDay(s.startsAt, ev.tz)}</p>
          <p className="tnum">{fmtTime(s.startsAt, ev.tz)} – {fmtTime(s.endsAt, ev.tz)} <span className="text-muted">({ev.tz})</span></p>
          {s.room && <p className="text-muted">{s.room.name}</p>}
        </div>
        {data!.membership && s.status !== 'draft' && <div className="rounded-lg border border-line bg-white p-4"><SessionActions s={s} onChange={q.reload} /></div>}
        {canSelfCheckin && <Notice tone="ok"><div className="flex flex-wrap items-center justify-between gap-2"><span>{s.mine?.checkedIn ? "You're checked in to this session ✓" : 'Self check-in is open for this session.'}</span>{!s.mine?.checkedIn && <Button variant="primary" onClick={checkin}>I'm here</Button>}</div></Notice>}
        <section aria-labelledby="about-h">
          <div className="flex items-center justify-between"><h3 id="about-h" className="font-semibold">About this session</h3>{canEdit && !editing && <Button small variant="ghost" onClick={() => { setDesc(s.description ?? ''); setEditing(true); }}>Edit description</Button>}</div>
          {editing ? (
            <form onSubmit={saveDesc} className="mt-2 space-y-2"><TextArea label="Description" rows={8} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={10000} /><div className="flex gap-2"><Button type="submit" variant="primary" busy={busy}>Save</Button><Button onClick={() => setEditing(false)}>Cancel</Button></div></form>
          ) : <p className="mt-1 whitespace-pre-line leading-relaxed">{s.description || <span className="text-muted">No description yet.</span>}</p>}
        </section>
        {(s.materials.length > 0 || canEdit) && (
          <section aria-labelledby="mat-h">
            <h3 id="mat-h" className="mb-1 font-semibold">Materials</h3>
            <ul className="space-y-1">
              {s.materials.map((m) => (
                <li key={m.index} className="flex items-center justify-between rounded border border-line bg-white px-3 py-2 text-sm">
                  <a className="text-brand underline" href={`/api/sessions/${s.id}/materials/${m.index}`}>{m.name}</a>
                  <span className="flex items-center gap-2 text-xs text-muted">{(m.size / 1024).toFixed(0)} KB{canEdit && <button className="text-bad hover:underline" onClick={async () => { await del(`/api/sessions/${s.id}/materials/${m.index}`); await q.reload(); }}>Remove</button>}</span>
                </li>
              ))}
              {!s.materials.length && <li className="text-sm text-muted">No files yet.</li>}
            </ul>
            {canEdit && <><input ref={file} type="file" hidden onChange={(e) => upload(e.target.files)} aria-label="Upload material" /><Button small className="mt-2" onClick={() => file.current?.click()}>Upload file (max 5 MB)</Button></>}
          </section>
        )}
        {started && joined && s.status === 'published' && (
          <section aria-labelledby="fb-h" className="rounded-lg border border-line bg-white p-4">
            <h3 id="fb-h" className="mb-2 font-semibold">How was it?</h3>
            <form onSubmit={feedback} className="space-y-3">
              <div role="radiogroup" aria-label="Rating" className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)} className={`size-10 rounded-md border text-xl ${rating >= n ? 'border-amber-400 bg-amber-50 text-amber-500' : 'border-line text-slate-300'}`}>★</button>)}
              </div>
              <TextArea label="Comment (optional)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
              <Button type="submit" variant="primary" disabled={!rating} busy={busy}>Send feedback</Button>
            </form>
          </section>
        )}
      </article>
      <aside className="space-y-3">
        {s.speakers.length > 0 && <h3 className="font-semibold">Speakers</h3>}
        {s.speakers.map((p) => (
          <Link key={p.id} to={`/e/${slug}/speaker/${p.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-white p-3 hover:bg-canvas">
            <Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} />
            <span className="min-w-0"><span className="block font-medium">{p.name}</span><span className="block truncate text-sm text-muted">{[p.title, p.org].filter(Boolean).join(', ')}</span></span>
          </Link>
        ))}
        {user?.role === 'admin' && <Link className="block text-sm text-brand underline" to={`/admin/events/${ev.id}/sessions`}>Edit in admin</Link>}
      </aside>
    </div>
  );
}
