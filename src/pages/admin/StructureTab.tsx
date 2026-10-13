import { useState, type FormEvent } from 'react';
import { del, get, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import type { Room, Track } from '../../lib/types';
import { Button, EmptyState, ErrorState, ListSkeleton, PageHeader, TextField, useConfirm, useToast } from '../../ui/kit';
import { useAdminEvent } from './EventLayout';

export function StructureTab() {
  const { ev } = useAdminEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery(async () => ({ tracks: (await get<{ tracks: Track[] }>(`/api/events/${ev.id}/tracks`)).tracks, rooms: (await get<{ rooms: Room[] }>(`/api/events/${ev.id}/rooms`)).rooms }), [ev.id]);
  const [track, setTrack] = useState({ name: '', color: '#4f46e5' });
  const [room, setRoom] = useState({ name: '', capacity: '' });
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const add = (fn: () => Promise<unknown>, reset: () => void) => async (e: FormEvent) => { e.preventDefault(); try { await fn(); reset(); await q.reload(); } catch (x) { toast.error(x); } };
  return (
    <>
      <PageHeader title="Tracks & rooms" sub="Tracks group sessions by topic; rooms say where they happen. Both can be used as filters on the public schedule." />
      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="tr-h" className="space-y-3">
          <h2 id="tr-h" className="font-semibold">Tracks</h2>
          <form onSubmit={add(() => post(`/api/events/${ev.id}/tracks`, track), () => setTrack({ ...track, name: '' }))} className="flex items-end gap-2">
            <TextField className="flex-1" label="Name" required value={track.name} onChange={(e) => setTrack({ ...track, name: e.target.value })} />
            <TextField className="w-20" label="Color" type="color" value={track.color} onChange={(e) => setTrack({ ...track, color: e.target.value })} />
            <Button type="submit" variant="primary">Add</Button>
          </form>
          {!q.data.tracks.length ? <EmptyState title="No tracks yet" /> : <ul className="divide-y divide-line rounded-lg border border-line bg-white">{q.data.tracks.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-3 py-2.5"><span className="flex items-center gap-2"><span aria-hidden className="size-3 rounded-full" style={{ background: t.color }} />{t.name}</span>
              <Button small variant="ghost" onClick={async () => { if (await confirm({ title: `Delete track “${t.name}”?`, body: 'Sessions keep existing but lose this track.', confirm: 'Delete', danger: true })) { await del(`/api/events/${ev.id}/tracks/${t.id}`); await q.reload(); } }}>Delete</Button></li>
          ))}</ul>}
        </section>
        <section aria-labelledby="rm-h" className="space-y-3">
          <h2 id="rm-h" className="font-semibold">Rooms</h2>
          <form onSubmit={add(() => post(`/api/events/${ev.id}/rooms`, { name: room.name, capacity: room.capacity ? Number(room.capacity) : null }), () => setRoom({ name: '', capacity: '' }))} className="flex items-end gap-2">
            <TextField className="flex-1" label="Name" required value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} />
            <TextField className="w-24" label="Seats" type="number" min={1} value={room.capacity} onChange={(e) => setRoom({ ...room, capacity: e.target.value })} />
            <Button type="submit" variant="primary">Add</Button>
          </form>
          {!q.data.rooms.length ? <EmptyState title="No rooms yet" /> : <ul className="divide-y divide-line rounded-lg border border-line bg-white">{q.data.rooms.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2.5"><span>{r.name}{r.capacity ? <span className="text-sm text-muted"> · {r.capacity} seats</span> : null}</span>
              <Button small variant="ghost" onClick={async () => { if (await confirm({ title: `Delete room “${r.name}”?`, body: 'Sessions in this room will have no room.', confirm: 'Delete', danger: true })) { await del(`/api/events/${ev.id}/rooms/${r.id}`); await q.reload(); } }}>Delete</Button></li>
          ))}</ul>}
        </section>
      </div>
    </>
  );
}
