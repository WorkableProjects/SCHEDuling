import { useState, type FormEvent } from 'react';
import { del, get, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { Avatar, Badge, Button, CopyLink, DataTable, Dialog, ErrorState, ListSkeleton, PageHeader, TextArea, TextField, useConfirm, useToast } from '../../ui/kit';
import { useAdminEvent } from './EventLayout';
import { ImportDialog } from './SessionsTab';

type A = { userId: string; name: string; email: string; role: string; ticketType: string; checkedInAt: string | null; status: string; qrToken: string };

export function PeopleTab() {
  const { ev } = useAdminEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery(() => get<{ attendees: A[] }>(`/api/people/attendees?eventId=${ev.id}`), [ev.id]);
  const [dlg, setDlg] = useState<'speaker' | 'attendee' | 'import' | null>(null);
  const [f, setF] = useState({ name: '', email: '', ticketType: 'General', title: '', org: '', bio: '' });
  const [link, setLink] = useState<{ email: string; link: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const rows = q.data.attendees;

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = dlg === 'speaker' ? await post('/api/people/speakers', { eventId: ev.id, name: f.name, email: f.email, title: f.title || null, org: f.org || null, bio: f.bio || null }) : await post('/api/people/attendees', { eventId: ev.id, name: f.name, email: f.email, ticketType: f.ticketType });
      setDlg(null); setF({ name: '', email: '', ticketType: 'General', title: '', org: '', bio: '' });
      if (r.inviteLink) setLink({ email: f.email, link: r.inviteLink }); else toast.ok('Added');
      await q.reload();
    } catch (x) { toast.error(x); } finally { setBusy(false); }
  }
  async function makeLink(a: A) { try { const r = await post(`/api/people/users/${a.userId}/link`); setLink({ email: a.email, link: r.link }); } catch (x) { toast.error(x); } }
  return (
    <>
      <PageHeader title="Speakers & attendees" sub={`${rows.length} people · ${rows.filter((r) => r.checkedInAt).length} checked in`}
        actions={<><Button onClick={() => setDlg('import')}>Import attendees CSV</Button><Button onClick={() => setDlg('speaker')}>Add speaker</Button><Button variant="primary" onClick={() => setDlg('attendee')}>Add attendee</Button></>} />
      {link && <div className="mb-4 space-y-1 rounded-lg border border-brand-line bg-brand-soft p-3"><p className="text-sm">Share this one-time link with <strong>{link.email}</strong>. No email is sent. It lets them set a password and sign in.</p><CopyLink label="Link" link={link.link} /><Button small variant="ghost" onClick={() => setLink(null)}>Dismiss</Button></div>}
      <DataTable rows={rows} rowKey={(r) => r.userId} searchText={(r) => `${r.name} ${r.email} ${r.ticketType}`} searchPlaceholder="Search people" empty="Nobody has joined yet."
        columns={[
          { key: 'name', header: 'Name', sort: (a, b) => a.name.localeCompare(b.name), render: (r) => <span className="flex items-center gap-2"><Avatar name={r.name} size={28} /><span><span className="font-medium">{r.name}</span><span className="block text-xs text-muted">{r.email}</span></span></span> },
          { key: 'role', header: 'Role', render: (r) => (r.role === 'speaker' ? <Badge tone="brand">Speaker</Badge> : 'Attendee') },
          { key: 'ticket', header: 'Ticket', sort: (a, b) => a.ticketType.localeCompare(b.ticketType), render: (r) => r.ticketType },
          { key: 'status', header: 'Account', render: (r) => (r.status === 'pending' ? <Badge tone="warn">Invited</Badge> : r.status === 'disabled' ? <Badge tone="bad">Disabled</Badge> : <Badge tone="ok">Active</Badge>) },
          { key: 'ci', header: 'Checked in', sort: (a, b) => (a.checkedInAt ?? '').localeCompare(b.checkedInAt ?? ''), render: (r) => (r.checkedInAt ? <span className="text-ok">{fmtDateTime(r.checkedInAt)}</span> : '–') },
          { key: 'act', header: '', render: (r) => <span className="flex justify-end gap-1">
            <Button small onClick={() => makeLink(r)}>{r.status === 'pending' ? 'Invite link' : 'Reset link'}</Button>
            <Button small variant="danger" onClick={async () => { if (await confirm({ title: `Remove ${r.name}?`, danger: true, confirm: 'Remove', body: 'Their agenda and registrations for this event are removed. Attendance history for sessions is kept.' })) { await del(`/api/people/attendees/${ev.id}/${r.userId}`); await q.reload(); } }}>Remove</Button></span> },
        ]} />
      <Dialog open={dlg === 'speaker' || dlg === 'attendee'} onClose={() => setDlg(null)} title={dlg === 'speaker' ? 'Add speaker' : 'Add attendee'} footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" type="submit" form="person-form" busy={busy}>Add</Button></>}>
        <form id="person-form" onSubmit={submit} className="space-y-3">
          <TextField label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          {dlg === 'attendee' ? <TextField label="Ticket type" value={f.ticketType} onChange={(e) => setF({ ...f, ticketType: e.target.value })} hint="Free ticket labels such as General, VIP, Student." /> : <>
            <div className="grid gap-3 sm:grid-cols-2"><TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><TextField label="Organization" value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} /></div>
            <TextArea label="Bio" value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></>}
        </form>
      </Dialog>
      <ImportDialog open={dlg === 'import'} onClose={() => setDlg(null)} onDone={q.reload} url="/api/people/attendees/import" eventId={ev.id} title="Import attendees from CSV" help="Columns: name, email, ticket_type (optional). New people get a one-time invite link; existing accounts are simply added to this event." sample={'name,email,ticket_type\nJordan Lee,jordan@example.com,VIP\nSam Patel,sam@example.com,General\n'} />
    </>
  );
}
