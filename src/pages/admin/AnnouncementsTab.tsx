import { useState, type FormEvent } from 'react';
import { del, get, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { Button, EmptyState, ErrorState, ListSkeleton, PageHeader, TextArea, TextField, useConfirm, useToast } from '../../ui/kit';
import { useAdminEvent } from './EventLayout';

export function AnnouncementsTab() {
  const { ev } = useAdminEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery(() => get<{ announcements: { id: string; title: string; body: string; createdAt: string }[] }>(`/api/comms/announcements?eventId=${ev.id}`), [ev.id]);
  const [f, setF] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!(await confirm({ title: 'Send to everyone?', body: 'Every person in this event gets an in-app notification right away. Announcements can\'t be unsent.', confirm: 'Send announcement' }))) return;
    setBusy(true);
    try { const r = await post(`/api/comms/events/${ev.id}/announcements`, f); toast.ok(`Sent to ${r.recipients} people`); setF({ title: '', body: '' }); await q.reload(); } catch (x) { toast.error(x); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Announcements" sub="In-app only. People see these in their notifications and on the event's welcome page." />
      <form onSubmit={send} className="mb-6 max-w-2xl space-y-3 rounded-lg border border-line bg-white p-4">
        <TextField label="Title" required maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <TextArea label="Message" required maxLength={5000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <Button type="submit" variant="primary" busy={busy}>Send announcement</Button>
      </form>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!q.data ? <ListSkeleton rows={2} /> : !q.data.announcements.length ? <EmptyState title="Nothing sent yet" /> : (
        <ul className="max-w-2xl space-y-2">{q.data.announcements.map((a) => <li key={a.id} className="rounded-lg border border-line bg-white p-4"><div className="flex justify-between gap-2"><p className="font-semibold">{a.title}</p><button className="text-sm text-bad hover:underline" onClick={async () => { await del(`/api/comms/announcements/${a.id}`); await q.reload(); }}>Remove from page</button></div><p className="whitespace-pre-line text-sm">{a.body}</p><p className="mt-1 text-xs text-muted">{fmtDateTime(a.createdAt)}</p></li>)}</ul>
      )}
    </>
  );
}
