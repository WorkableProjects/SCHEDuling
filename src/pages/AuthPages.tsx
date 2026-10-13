import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useQuery } from '../lib/hooks';
import { Button, CopyLink, ErrorState, ListSkeleton, Notice, TextField } from '../ui/kit';
import { NotFound } from './NotFound';

function Shell({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold">{title}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      <div className="mt-6 rounded-lg border border-line bg-white p-5">{children}</div>
    </div>
  );
}

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null);

export function Login() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await post('/api/auth/login', { email, password });
      setSession(r);
      nav(safeNext(sp.get('next')) ?? (r.user.role === 'admin' ? '/admin' : r.user.role === 'checkin_staff' ? '/' : '/'), { replace: true });
    } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); } finally { setBusy(false); }
  }
  return (
    <Shell title="Sign in" sub={<>New here? <Link className="text-brand underline" to={`/signup${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`}>Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <TextField label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button variant="primary" type="submit" busy={busy} className="w-full">Sign in</Button>
        <p className="text-center text-[13px] text-muted">Forgot your password? Ask an event admin for a one-time reset link.</p>
      </form>
    </Shell>
  );
}

export function Signup() {
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { setSession(await post('/api/auth/signup', f)); nav(safeNext(sp.get('next')) ?? '/', { replace: true }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign-up failed'); } finally { setBusy(false); }
  }
  return (
    <Shell title="Create your account" sub={<>Already registered? <Link className="text-brand underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <TextField label="Full name" autoComplete="name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <TextField label="Email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <TextField label="Password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters." value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Button variant="primary" type="submit" busy={busy} className="w-full">Create account</Button>
      </form>
    </Shell>
  );
}

/** Invite, activation and password-reset links all land here. */
export function Activate() {
  const { token = '' } = useParams();
  const { setSession } = useAuth();
  const nav = useNavigate();
  const q = useQuery(() => get<{ purpose: 'activate' | 'invite' | 'reset'; email: string; name: string; role: string }>(`/api/auth/token/${token}`), [token]);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.loading && !q.data) return <Shell title="One moment"><ListSkeleton rows={2} /></Shell>;
  if (q.error) return <Shell title="Link not valid"><ErrorState error={q.error} /><p className="mt-3 text-sm text-muted">Ask an admin to generate a new link for you.</p></Shell>;
  const info = q.data!;
  const reset = info.purpose === 'reset';
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true); setError(null);
    try {
      const r = await post('/api/auth/activate', { token, password, ...(name.trim() && !reset ? { name: name.trim() } : {}) });
      setSession(r); nav(r.user.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save password'); } finally { setBusy(false); }
  }
  return (
    <Shell title={reset ? 'Choose a new password' : 'Welcome — set your password'} sub={<>for <strong>{info.email}</strong></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        {!reset && <TextField label="Your name" autoComplete="name" defaultValue={info.name} onChange={(e) => setName(e.target.value)} />}
        <TextField label="Password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters." value={password} onChange={(e) => setPassword(e.target.value)} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button variant="primary" type="submit" busy={busy} className="w-full">{reset ? 'Save password' : 'Activate account'}</Button>
      </form>
    </Shell>
  );
}

/** One-time bootstrap of the two admin accounts. The API answers 404 once any admin exists. */
export function Setup() {
  const q = useQuery(() => get('/api/setup'), []);
  const [token, setToken] = useState('');
  const [emails, setEmails] = useState(['', '']);
  const [links, setLinks] = useState<{ email: string; link: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.loading && !q.data) return <Shell title="Setup"><ListSkeleton rows={2} /></Shell>;
  if (q.error?.status === 404) return <NotFound />;
  if (q.error?.code === 'not_configured') {
    return <Shell title="Setup isn't enabled yet"><Notice tone="warn">Add a secret environment variable named <code>ADMIN_BOOTSTRAP_TOKEN</code> in the Netlify UI (Site configuration → Environment variables), redeploy, then come back to this page.</Notice></Shell>;
  }
  if (q.error) return <Shell title="Setup"><ErrorState error={q.error} onRetry={q.reload} /></Shell>;
  if (links) {
    return (
      <Shell title="Admins created" sub="Send each person their own link. Each link works once and sets that admin's password.">
        <div className="space-y-3">{links.map((l) => <div key={l.email}><p className="mb-1 text-sm font-medium">{l.email}</p><CopyLink label="Activation" link={l.link} /></div>)}</div>
        <Notice tone="warn">These links are shown only now. This page is permanently disabled once an admin exists.</Notice>
      </Shell>
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { setLinks((await post('/api/setup', { token, emails: emails.map((x) => x.trim().toLowerCase()) })).links); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Setup failed'); } finally { setBusy(false); }
  }
  return (
    <Shell title="Set up SCHEDuling" sub="Create the two administrator accounts. This works once.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <TextField label="Setup token" type="password" required autoComplete="off" hint="The value of ADMIN_BOOTSTRAP_TOKEN in your Netlify environment." value={token} onChange={(e) => setToken(e.target.value)} />
        <TextField label="Admin 1 email" type="email" required value={emails[0]} onChange={(e) => setEmails([e.target.value, emails[1]!])} />
        <TextField label="Admin 2 email" type="email" required value={emails[1]} onChange={(e) => setEmails([emails[0]!, e.target.value])} />
        <Button variant="primary" type="submit" busy={busy} className="w-full">Create admin accounts</Button>
      </form>
    </Shell>
  );
}
