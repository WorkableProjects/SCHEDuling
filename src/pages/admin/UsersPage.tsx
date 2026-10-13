import { useState, type FormEvent } from 'react';
import { get, patch, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/hooks';
import { Badge, Button, CopyLink, DataTable, Dialog, ErrorState, ListSkeleton, Notice, PageHeader, SelectField, TextField, useConfirm, useToast } from '../../ui/kit';

type U = { id: string; email: string; name: string; role: string; status: string; createdAt: string };
const roles = [['attendee', 'Attendee'], ['speaker', 'Speaker'], ['checkin_staff', 'Check-in staff'], ['admin', 'Admin']];

export function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery(() => get<{ users: U[] }>('/api/people/users'), []);
  const [dlg, setDlg] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'checkin_staff' });
  const [link, setLink] = useState<{ email: string; link: string; note?: string } | null>(null);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  const admins = q.data.users.filter((u) => u.role === 'admin' && u.status !== 'disabled').length;

  async function changeRole(u: U, role: string) {
    const ok = await confirm({ title: `Make ${u.name} ${role === 'admin' ? 'an admin' : `a ${role.replace('_', ' ')}`}?`, confirm: 'Change role', danger: u.role === 'admin', body: role === 'admin' ? 'Admins have full access to everything. Only 2 admin accounts are allowed.' : u.role === 'admin' ? 'They lose all admin access immediately.' : 'This changes what they can do across the site.' });
    if (!ok) return;
    try { await patch(`/api/people/users/${u.id}/role`, { role }); toast.ok('Role updated'); } catch (e) { toast.error(e); }
    await q.reload();
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    try { const r = await post('/api/people/users', f); setLink({ email: f.email, link: r.inviteLink }); setDlg(false); setF({ name: '', email: '', role: 'checkin_staff' }); await q.reload(); } catch (x) { toast.error(x); }
  }
  async function makeLink(u: U) { try { const r = await post(`/api/people/users/${u.id}/link`); setLink({ email: u.email, link: r.link, note: r.purpose === 'reset' ? 'Password reset link: expires in 60 minutes and signs them out everywhere.' : undefined }); } catch (x) { toast.error(x); } }
  return (
    <>
      <PageHeader title="Users & admins" sub={<>{admins} of 2 admin seats in use</>} actions={<Button variant="primary" onClick={() => setDlg(true)}>Add user</Button>} />
      {link && <div className="mb-4 space-y-1 rounded-lg border border-brand-line bg-brand-soft p-3"><p className="text-sm">One-time link for <strong>{link.email}</strong>. Share it privately; no email is sent. {link.note}</p><CopyLink label="Link" link={link.link} /><Button small variant="ghost" onClick={() => setLink(null)}>Dismiss</Button></div>}
      <DataTable rows={q.data.users} rowKey={(u) => u.id} searchText={(u) => `${u.name} ${u.email} ${u.role}`} searchPlaceholder="Search users" pageSize={20}
        columns={[
          { key: 'n', header: 'User', sort: (a, b) => a.name.localeCompare(b.name), render: (u) => <><span className="font-medium">{u.name}</span>{u.id === me!.id && <Badge tone="brand" className="ml-2">You</Badge>}<span className="block text-xs text-muted">{u.email}</span></> },
          { key: 'r', header: 'Role', render: (u) => <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => changeRole(u, e.target.value)} className="rounded-md border border-line bg-white px-2 py-1.5 text-sm">{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> },
          { key: 's', header: 'Status', render: (u) => (u.status === 'pending' ? <Badge tone="warn">Not activated</Badge> : u.status === 'disabled' ? <Badge tone="bad">Disabled</Badge> : <Badge tone="ok">Active</Badge>) },
          { key: 'a', header: '', render: (u) => <span className="flex justify-end gap-1"><Button small onClick={() => makeLink(u)}>{u.status === 'pending' ? 'Activation link' : 'Reset password'}</Button>
            {u.status === 'disabled' ? <Button small onClick={async () => { await post(`/api/people/users/${u.id}/enable`); await q.reload(); }}>Enable</Button> : <Button small variant="danger" onClick={async () => { if (await confirm({ title: `Disable ${u.name}?`, danger: true, confirm: 'Disable', body: 'They are signed out and can no longer sign in.' })) { try { await post(`/api/people/users/${u.id}/disable`); } catch (e) { toast.error(e); } await q.reload(); } }}>Disable</Button>}</span> },
        ]} />
      <div className="mt-4"><Notice>Public sign-up only ever creates attendees. Admin accounts are limited to two; to swap one, demote an admin first.</Notice></div>
      <Dialog open={dlg} onClose={() => setDlg(false)} title="Add user" footer={<><Button onClick={() => setDlg(false)}>Cancel</Button><Button variant="primary" type="submit" form="user-form">Create & get link</Button></>}>
        <form id="user-form" onSubmit={create} className="space-y-3">
          <TextField label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <SelectField label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} hint="Admin accounts are made by changing an existing user's role."><option value="checkin_staff">Check-in staff (volunteer)</option><option value="speaker">Speaker</option><option value="attendee">Attendee</option></SelectField>
        </form>
      </Dialog>
    </>
  );
}
