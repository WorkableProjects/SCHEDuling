import { useRef, useState, type FormEvent } from 'react';
import { del, get, patch, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { fmtDayShort, fmtTime, isoToLocalInput, localInputToIso } from '../../lib/format';
import type { Room, Session, Track } from '../../lib/types';
import { Badge, Button, Check, DataTable, Dialog, ErrorState, ListSkeleton, Notice, PageHeader, SelectField, TextArea, TextField, useConfirm, useToast } from '../../ui/kit';
import { useAdminEvent } from './EventLayout';

type Spk = { id: string; name: string; email: string; role: string };
const blank = { title: '', description: '', start: '', end: '', roomId: '', status: 'draft', capacity: '', requiresRegistration: false, pinned: false, frozen: false, trackIds: [] as string[], speakerIds: [] as string[] };

export function SessionsTab() {
  const { ev } = useAdminEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery(async () => {
    const [s, t, r, u] = await Promise.all([
      get<{ sessions: Session[] }>(`/api/sessions?eventId=${ev.id}`), get<{ tracks: Track[] }>(`/api/events/${ev.id}/tracks`),
      get<{ rooms: Room[] }>(`/api/events/${ev.id}/rooms`), get<{ users: Spk[] }>('/api/people/users'),
    ]);
    return { sessions: s.sessions, tracks: t.tracks, rooms: r.rooms, speakers: u.users.filter((x) => x.role === 'speaker') };
  }, [ev.id]);
  const [editing, setEditing] = useState<{ id?: string; f: typeof blank } | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const d = q.data;
  const drafts = d.sessions.filter((s) => s.status === 'draft').length;

  const open = (s?: Session) => { setErr(null); setEditing(s ? { id: s.id, f: { title: s.title, description: s.description ?? '', start: isoToLocalInput(s.startsAt, ev.tz), end: isoToLocalInput(s.endsAt, ev.tz), roomId: s.room?.id ?? '', status: s.status, capacity: s.capacity?.toString() ?? '', requiresRegistration: s.requiresRegistration, pinned: s.pinned, frozen: s.frozen && !ev.settings.scheduleFrozen, trackIds: s.tracks.map((t) => t.id), speakerIds: s.speakers.map((p) => p.id) } } : { f: { ...blank, start: `${ev.startDate}T09:00`, end: `${ev.startDate}T10:00` } }); };
  async function save(e: FormEvent) {
    e.preventDefault(); if (!editing) return; const f = editing.f; setBusy(true); setErr(null);
    const body = { eventId: ev.id, title: f.title, description: f.description || null, startsAt: localInputToIso(f.start, ev.tz), endsAt: localInputToIso(f.end, ev.tz), roomId: f.roomId || null, status: f.status, capacity: f.capacity ? Number(f.capacity) : null, requiresRegistration: f.requiresRegistration, pinned: f.pinned, frozen: f.frozen, trackIds: f.trackIds, speakerIds: f.speakerIds };
    try { if (editing.id) await patch(`/api/sessions/${editing.id}`, body); else await post('/api/sessions', body); toast.ok('Session saved'); setEditing(null); await q.reload(); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Failed'); } finally { setBusy(false); }
  }
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setEditing((p) => p && { ...p, f: { ...p.f, [k]: v } });

  return (
    <>
      <PageHeader title="Sessions" sub={`${d.sessions.length} sessions · ${drafts} drafts`} actions={<>
        {drafts > 0 && <Button onClick={async () => { if (await confirm({ title: `Publish ${drafts} drafts?`, body: 'Attendees will see them immediately.', confirm: 'Publish all' })) { await post('/api/sessions/bulk', { eventId: ev.id, action: 'publish' }); toast.ok('Published'); await q.reload(); } }}>Publish all drafts</Button>}
        <Button onClick={() => setImporting(true)}>Import CSV</Button><Button variant="primary" onClick={() => open()}>New session</Button></>} />
      <DataTable rows={d.sessions} rowKey={(s) => s.id} searchText={(s) => `${s.title} ${s.speakers.map((p) => p.name).join(' ')} ${s.room?.name ?? ''}`} searchPlaceholder="Search sessions" empty="No sessions yet. Add one or import a CSV."
        columns={[
          { key: 'title', header: 'Session', sort: (a, b) => a.title.localeCompare(b.title), render: (s) => <><span className="font-medium">{s.title}</span><span className="block text-xs text-muted">{s.speakers.map((p) => p.name).join(', ')}</span></> },
          { key: 'when', header: 'When', sort: (a, b) => a.startsAt.localeCompare(b.startsAt), render: (s) => <span className="tnum">{fmtDayShort(s.startsAt, ev.tz)} · {fmtTime(s.startsAt, ev.tz)}</span> },
          { key: 'room', header: 'Room', render: (s) => s.room?.name ?? '–' },
          { key: 'status', header: 'Status', render: (s) => <span className="flex flex-wrap gap-1"><Badge tone={s.status === 'published' ? 'ok' : s.status === 'cancelled' ? 'bad' : 'warn'}>{s.status}</Badge>{s.pinned && <Badge tone="brand">pinned</Badge>}{s.frozen && <Badge>frozen</Badge>}</span> },
          { key: 'reg', header: 'Registered', className: 'tnum', render: (s) => (s.requiresRegistration ? `${s.registeredCount ?? 0}${s.capacity ? ` / ${s.capacity}` : ''}` : '–') },
          { key: 'act', header: '', render: (s) => <span className="flex justify-end gap-1"><Button small onClick={() => open(s)}>Edit</Button><Button small variant="danger" onClick={async () => { if (await confirm({ title: 'Delete session?', danger: true, confirm: 'Delete', body: `“${s.title}” and its registrations will be removed${s.status === 'published' ? '; people who planned to attend will be notified' : ''}.` })) { await del(`/api/sessions/${s.id}`); await q.reload(); } }}>Delete</Button></span> },
        ]} />
      <Dialog wide open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit session' : 'New session'}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="session-form" busy={busy}>Save session</Button></>}>
        {editing && (
          <form id="session-form" onSubmit={save} className="space-y-4">
            {err && <Notice tone="bad">{err}</Notice>}
            <TextField label="Title" required value={editing.f.title} onChange={(e) => set('title', e.target.value)} />
            <TextArea label="Description" value={editing.f.description} onChange={(e) => set('description', e.target.value)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={`Starts (${ev.tz})`} type="datetime-local" required value={editing.f.start} onChange={(e) => set('start', e.target.value)} />
              <TextField label="Ends" type="datetime-local" required value={editing.f.end} onChange={(e) => set('end', e.target.value)} />
              <SelectField label="Room" value={editing.f.roomId} onChange={(e) => set('roomId', e.target.value)}><option value="">No room</option>{d.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectField>
              <SelectField label="Status" value={editing.f.status} onChange={(e) => set('status', e.target.value)}><option value="draft">Draft (private)</option><option value="published">Published</option><option value="cancelled">Cancelled</option></SelectField>
            </div>
            <fieldset><legend className="mb-1 text-sm font-medium">Tracks</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{d.tracks.map((t) => <Check key={t.id} label={t.name} checked={editing.f.trackIds.includes(t.id)} onChange={() => set('trackIds', toggle(editing.f.trackIds, t.id))} />)}{!d.tracks.length && <span className="text-sm text-muted">Add tracks under “Tracks & rooms”.</span>}</div></fieldset>
            <fieldset><legend className="mb-1 text-sm font-medium">Speakers</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{d.speakers.map((p) => <Check key={p.id} label={p.name} checked={editing.f.speakerIds.includes(p.id)} onChange={() => set('speakerIds', toggle(editing.f.speakerIds, p.id))} />)}{!d.speakers.length && <span className="text-sm text-muted">Add speakers under “Speakers & attendees”.</span>}</div></fieldset>
            <div className="space-y-3 rounded-md border border-line bg-canvas p-3">
              <Check label="Requires registration" hint="Attendees must register to hold a seat. Enforces capacity, waitlist and attendance." checked={editing.f.requiresRegistration} onChange={(v) => set('requiresRegistration', v)} />
              <TextField label="Capacity" type="number" min={1} value={editing.f.capacity} onChange={(e) => set('capacity', e.target.value)} hint="Leave blank for unlimited. Extra people go on a waitlist." />
              <Check label="Pinned" hint="Appears on every attendee's agenda. Does not register them." checked={editing.f.pinned} onChange={(v) => set('pinned', v)} />
              <Check label="Frozen" hint="Attendees can't join or leave this session. Admins can still enroll people." checked={editing.f.frozen} onChange={(v) => set('frozen', v)} />
            </div>
          </form>
        )}
      </Dialog>
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={q.reload} url="/api/sessions/import" eventId={ev.id} title="Import sessions from CSV"
        help="Columns: title, start, end (YYYY-MM-DD HH:mm in the event's time zone), room, tracks (a;b), speakers (emails, a;b), capacity, requires_registration, pinned, frozen, status, description. Include an id column to update existing sessions (e.g. bulk capacities)." sample={'title,start,end,room,tracks,speakers,capacity,requires_registration,pinned\nOpening keynote,2030-05-01 09:00,2030-05-01 10:00,Main Hall,Keynote,ada@example.com,300,yes,yes\n'} />
    </>
  );
}

export function ImportDialog({ open, onClose, onDone, url, eventId, title, help, sample }: { open: boolean; onClose: () => void; onDone: () => void | Promise<void>; url: string; eventId: string; title: string; help: string; sample: string }) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const [result, setResult] = useState<any>(null);
  const file = useRef<HTMLInputElement>(null);
  const run = async (dryRun: boolean) => {
    setBusy(true); setErrors([]); setResult(null);
    try { const r = await post(url, { eventId, csv, dryRun }); setResult(r); if (!dryRun) await onDone(); }
    catch (e: any) { if (e.data?.errors) setErrors(e.data.errors); else setErrors([{ row: 0, message: e.message }]); } finally { setBusy(false); }
  };
  return (
    <Dialog wide open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>Close</Button><Button disabled={!csv} busy={busy} onClick={() => run(true)}>Check file</Button><Button variant="primary" disabled={!csv || busy} onClick={() => run(false)}>Import</Button></>}>
      <p className="mb-3 text-sm text-muted">{help}</p>
      <div className="mb-2 flex gap-2"><input ref={file} type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} /><Button small onClick={() => file.current?.click()}>Choose CSV file</Button><Button small variant="ghost" onClick={() => setCsv(sample)}>Use example</Button></div>
      <TextArea label="CSV" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono" spellCheck={false} />
      {errors.length > 0 && <div className="mt-3"><Notice tone="bad"><p className="font-semibold">Nothing was imported. Fix these rows:</p><ul className="mt-1 list-disc pl-5">{errors.slice(0, 20).map((e, i) => <li key={i}>{e.row ? `Row ${e.row}: ` : ''}{e.message}</li>)}</ul></Notice></div>}
      {result && <div className="mt-3"><Notice tone="ok">{result.dryRun ? `File looks good: ${result.count ?? result.created + result.updated} rows ready to import.` : `Imported. ${result.created ?? 0} created${result.updated ? `, ${result.updated} updated` : ''}${result.existing ? `, ${result.existing} already existed` : ''}.`}
        {result.skipped?.length > 0 && <p>Skipped: {result.skipped.map((s: any) => `${s.email} (${s.reason})`).join('; ')}</p>}</Notice>
        {result.invites?.length > 0 && <InviteList invites={result.invites} />}</div>}
    </Dialog>
  );
}

export function InviteList({ invites }: { invites: { email: string; link: string }[] }) {
  return (
    <div className="mt-3"><p className="mb-1 text-sm font-medium">One-time invite links (email isn't sent. Copy and share each one):</p>
      <div className="max-h-48 overflow-y-auto rounded border border-line"><table className="w-full text-xs"><tbody>{invites.map((i) => <tr key={i.email} className="border-b border-line last:border-0"><td className="px-2 py-1">{i.email}</td><td className="px-2 py-1 text-right"><button className="text-brand underline" onClick={() => navigator.clipboard.writeText(i.link)}>Copy link</button></td></tr>)}</tbody></table></div>
      <Button small className="mt-2" onClick={() => navigator.clipboard.writeText(invites.map((i) => `${i.email}\t${i.link}`).join('\n'))}>Copy all</Button></div>
  );
}
