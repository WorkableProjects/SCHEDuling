import { useRef, useState, type FormEvent } from 'react';
import { get, patch, post, del, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useQuery } from '../lib/hooks';
import { Avatar, Button, CopyLink, Notice, PageHeader, TextArea, TextField, useToast } from '../ui/kit';

export function Account() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ name: user!.name, title: user!.title ?? '', org: user!.org ?? '', bio: user!.bio ?? '' });
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoVer, setPhotoVer] = useState(0);
  const [pw, setPw] = useState({ current: '', next: '' });
  const ical = useQuery(() => get<{ icalToken: string }>('/api/auth/ical-token'), []);

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await patch('/api/auth/me', { name: f.name, title: f.title || null, org: f.org || null, bio: f.bio || null }); await refresh(); toast.ok('Profile saved'); }
    catch (err) { toast.error(err); } finally { setBusy(false); }
  }
  async function upload(files: FileList | null) {
    const x = files?.[0]; if (!x) return;
    setPhotoBusy(true);
    try { const fd = new FormData(); fd.set('file', x); await api('PUT', '/api/files/photo/me', fd); await refresh(); setPhotoVer((v) => v + 1); toast.ok('Photo updated'); }
    catch (err) { toast.error(err); } finally { setPhotoBusy(false); if (file.current) file.current.value = ''; }
  }
  async function changePw(e: FormEvent) {
    e.preventDefault();
    try { await post('/api/auth/password', pw); setPw({ current: '', next: '' }); toast.ok('Password changed. Other devices were signed out.'); } catch (err) { toast.error(err); }
  }
  const icalUrl = ical.data ? `${location.origin}/api/ical/${ical.data.icalToken}.ics` : '';
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader title="Your account" sub={`${user!.email} · ${user!.role.replace('_', ' ')}`} />
      <section className="space-y-4 rounded-lg border border-line bg-white p-5" aria-labelledby="profile-h">
        <h2 id="profile-h" className="font-semibold">Profile</h2>
        <div className="flex items-center gap-4">
          <span key={photoVer}><Avatar name={user!.name} userId={user!.id} hasPhoto={user!.hasPhoto} size={64} /></span>
          <div className="flex gap-2">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files)} aria-label="Choose photo" />
            <Button busy={photoBusy} onClick={() => file.current?.click()}>{user!.hasPhoto ? 'Change photo' : 'Add photo'}</Button>
            {user!.hasPhoto && <Button variant="ghost" onClick={async () => { await del('/api/files/photo/me'); await refresh(); }}>Remove</Button>}
          </div>
        </div>
        <form onSubmit={save} className="space-y-4">
          <TextField label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <TextField label="Organization" value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })} />
          </div>
          <TextArea label="Bio" hint="Shown on speaker pages and in the attendee directory." value={f.bio} maxLength={2000} onChange={(e) => setF({ ...f, bio: e.target.value })} />
          <Button variant="primary" type="submit" busy={busy}>Save profile</Button>
        </form>
      </section>
      <section className="mt-6 space-y-3 rounded-lg border border-line bg-white p-5" aria-labelledby="cal-h">
        <h2 id="cal-h" className="font-semibold">Calendar feed</h2>
        <p className="text-sm text-muted">Subscribe in Google Calendar, Apple Calendar or Outlook to keep your agenda in sync. Anyone with this link can see your agenda, so keep it private.</p>
        {icalUrl && <CopyLink label="iCal" link={icalUrl} />}
        <Button small onClick={async () => { await post('/api/auth/ical-token/rotate'); await ical.reload(); toast.ok('New link created. The old one stopped working.'); }}>Reset link</Button>
      </section>
      <section className="mt-6 rounded-lg border border-line bg-white p-5" aria-labelledby="pw-h">
        <h2 id="pw-h" className="mb-3 font-semibold">Change password</h2>
        <form onSubmit={changePw} className="space-y-4">
          <TextField label="Current password" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <TextField label="New password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters." value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <Button type="submit">Change password</Button>
        </form>
      </section>
      <div className="mt-4"><Notice>Forgot your password? An event admin can generate a one-time reset link for you.</Notice></div>
    </div>
  );
}
