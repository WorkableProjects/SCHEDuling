import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounced, useQuery } from '../lib/hooks';
import { fmtTime } from '../lib/format';
import { Badge, Button, ErrorState, ListSkeleton, Notice, SelectField, cx } from '../ui/kit';

type Sess = { id: string; title: string; startsAt: string };
type Result = { tone: 'ok' | 'dup' | 'bad'; title: string; lines: string[]; warning?: string };
type Person = { userId: string; name: string; email: string; ticketType: string; checkedInAt: string | null; sessionCheckedIn?: boolean };
type Stats = { members: number; checkedIn: number; sessions: { id: string; title: string; startsAt: string; capacity: number | null; registered: number; waitlisted: number; checkedIn: number }[] };

export default function CheckinApp() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const meta = useQuery(() => get<{ sessions: Sess[]; event: { id: string; name: string; slug: string; tz: string } }>(`/api/checkin/${slug}/sessions`), [slug]);
  const [tab, setTab] = useState<'scan' | 'search' | 'stats'>('scan');
  const [sessionId, setSessionId] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const evId = meta.data?.event.id;

  const loadStats = useCallback(async () => { if (evId) try { setStats(await get(`/api/checkin/${evId}/stats`)); } catch { /* keep last */ } }, [evId]);
  useEffect(() => { void loadStats(); const t = setInterval(loadStats, 10_000); return () => clearInterval(t); }, [loadStats]);

  const report = useCallback((r: any) => {
    const lines = [r.person.email, r.person.ticketType];
    if (r.session) {
      setResult({ tone: r.session.alreadyCheckedIn ? 'dup' : 'ok', title: r.person.name, lines: [...lines, r.session.alreadyCheckedIn ? `Already checked in to ${r.session.title}` : `Checked in to ${r.session.title}`], warning: r.session.warning });
    } else setResult({ tone: r.event.alreadyCheckedIn ? 'dup' : 'ok', title: r.person.name, lines: [...lines, r.event.alreadyCheckedIn ? 'Already checked in' : 'Checked in to the event'] });
    void loadStats();
    navigator.vibrate?.(r.event.alreadyCheckedIn && !r.session ? [60, 60, 60] : 80);
  }, [loadStats]);
  const fail = (e: unknown) => setResult({ tone: 'bad', title: 'Could not check in', lines: [e instanceof Error ? e.message : 'Unknown error'] });

  const scan = useCallback(async (code: string) => {
    if (!evId) return;
    try { report(await post(`/api/checkin/${evId}/scan`, { qrToken: code, ...(sessionId ? { sessionId } : {}) })); } catch (e) { fail(e); }
  }, [evId, sessionId, report]);

  if (meta.error) return <div className="mx-auto max-w-md p-4"><ErrorState error={meta.error} onRetry={meta.reload} /></div>;
  if (!meta.data) return <div className="mx-auto max-w-md p-4"><ListSkeleton rows={3} /></div>;
  const ev = meta.data.event;
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-canvas">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-3">
        <div className="min-w-0"><p className="truncate font-semibold">{ev.name}</p><p className="text-xs text-muted">Check-in · {user?.name}</p></div>
        <div className="flex items-center gap-3"><Link to="/" className="text-sm text-brand underline">Exit</Link></div>
      </header>
      <div className="space-y-3 p-4">
        <SelectField label="Checking in to" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">Event entry (all-day)</option>
          {meta.data.sessions.map((s) => <option key={s.id} value={s.id}>{fmtTime(s.startsAt, ev.tz)} · {s.title}</option>)}
        </SelectField>
        {stats && (
          <div className="rounded-lg border border-line bg-white p-3" aria-label="Live counts">
            <div className="flex items-baseline justify-between"><p className="text-sm text-muted">Checked in</p><p className="text-2xl font-bold tnum">{stats.checkedIn}<span className="text-base font-normal text-muted"> / {stats.members}</span></p></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded bg-slate-100" role="progressbar" aria-valuenow={stats.checkedIn} aria-valuemax={stats.members}><div className="h-full bg-brand" style={{ width: `${stats.members ? (stats.checkedIn / stats.members) * 100 : 0}%` }} /></div>
          </div>
        )}
        <div role="tablist" aria-label="Check-in mode" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-200 p-1 text-sm font-medium">
          {([['scan', 'Scan QR'], ['search', 'Find person'], ['stats', 'Sessions']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-md py-2', tab === k ? 'bg-white shadow-sm' : 'text-muted')}>{l}</button>
          ))}
        </div>
        {result && <ResultCard r={result} onClose={() => setResult(null)} />}
        {tab === 'scan' && <ScanTab onCode={scan} />}
        {tab === 'search' && <SearchTab evId={ev.id} sessionId={sessionId} onDone={report} onFail={fail} isAdmin={user?.role === 'admin'} />}
        {tab === 'stats' && <SessionStats stats={stats} tz={ev.tz} />}
      </div>
    </div>
  );
}

function ResultCard({ r, onClose }: { r: Result; onClose: () => void }) {
  const style = { ok: 'border-green-300 bg-green-50 text-green-900', dup: 'border-amber-300 bg-amber-50 text-amber-900', bad: 'border-red-300 bg-red-50 text-red-900' }[r.tone];
  const icon = { ok: '✓', dup: '↺', bad: '✕' }[r.tone];
  return (
    <div role="status" aria-live="assertive" className={`rounded-xl border-2 p-4 ${style}`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="flex items-center gap-2 text-xl font-bold"><span aria-hidden className="text-2xl">{icon}</span>{r.title}</p>{r.lines.map((l, i) => <p key={i} className="text-sm">{l}</p>)}{r.warning && <p className="mt-1 text-sm font-semibold">⚠ {r.warning}</p>}</div>
        <button aria-label="Dismiss" onClick={onClose} className="rounded p-1 hover:bg-black/5">✕</button>
      </div>
    </div>
  );
}

/** Camera scanner: native BarcodeDetector when available, html5-qrcode otherwise. Also accepts typed/hardware-scanner input. */
function ScanTab({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef({ code: '', at: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState<'idle' | 'starting' | 'running' | 'denied' | 'unsupported'>('idle');
  const [manual, setManual] = useState('');
  const stop = useRef<() => void>(() => {});

  const handle = useCallback((code: string) => {
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 4000) return; // ignore repeats while the badge stays in frame
    last.current = { code, at: now };
    onCodeRef.current(code);
  }, []);

  const start = useCallback(async () => {
    setState('starting');
    try {
      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const v = video.current!; v.srcObject = stream; await v.play();
        let alive = true;
        const tick = async () => { if (!alive) return; try { const codes = await detector.detect(v); if (codes[0]?.rawValue) handle(codes[0].rawValue); } catch { /* frame not ready */ } setTimeout(tick, 200); };
        void tick();
        stop.current = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); };
        setState('running');
      } else {
        const { Html5Qrcode } = await import('html5-qrcode');
        const scanner = new Html5Qrcode('qr-region');
        await scanner.start({ facingMode: 'environment' }, { fps: 8, qrbox: 240 }, (t) => handle(t), () => {});
        stop.current = () => { scanner.stop().then(() => scanner.clear()).catch(() => {}); };
        setState('running');
      }
    } catch (e) {
      setState(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'unsupported');
    }
  }, [handle]);
  useEffect(() => () => stop.current(), []);

  function submitManual(e: FormEvent) { e.preventDefault(); if (manual.trim()) { onCodeRef.current(manual.trim()); setManual(''); } }
  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-900">
        <video ref={video} muted playsInline className={cx('size-full object-cover', !('BarcodeDetector' in window) && 'hidden')} />
        <div id="qr-region" className={cx('size-full', 'BarcodeDetector' in window && 'hidden')} />
        {state !== 'running' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            {state === 'denied' && <p>Camera access was blocked. Allow the camera in your browser settings, or use “Find person” instead.</p>}
            {state === 'unsupported' && <p>Couldn't start the camera on this device. Use “Find person”, or type the code below.</p>}
            {(state === 'idle' || state === 'denied' || state === 'unsupported') && <Button variant="primary" onClick={start}>{state === 'idle' ? 'Start camera' : 'Try again'}</Button>}
            {state === 'starting' && <p>Starting camera…</p>}
          </div>
        )}
        {state === 'running' && <div aria-hidden className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/80" />}
      </div>
      <form onSubmit={submitManual} className="flex gap-2">
        <input value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Ticket code" placeholder="Type or scan a ticket code" autoComplete="off" className="min-h-10 flex-1 rounded-md border border-line bg-white px-3" />
        <Button type="submit">Check in</Button>
      </form>
    </div>
  );
}

function SearchTab({ evId, sessionId, onDone, onFail, isAdmin }: { evId: string; sessionId: string; onDone: (r: any) => void; onFail: (e: unknown) => void; isAdmin: boolean }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const res = useQuery(() => (dq ? get<{ people: Person[] }>(`/api/checkin/${evId}/search?q=${encodeURIComponent(dq)}${sessionId ? `&sessionId=${sessionId}` : ''}`) : Promise.resolve({ people: [] as Person[] })), [dq, evId, sessionId]);
  const [busy, setBusy] = useState<string | null>(null);
  async function checkin(p: Person) {
    setBusy(p.userId);
    try { onDone(await post(`/api/checkin/${evId}/manual`, { userId: p.userId, ...(sessionId ? { sessionId } : {}) })); await res.reload(); } catch (e) { onFail(e); } finally { setBusy(null); }
  }
  return (
    <div className="space-y-3">
      <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by name or email" placeholder="Search by name or email" className="min-h-12 w-full rounded-md border border-line bg-white px-3 text-base" />
      {res.error && <ErrorState error={res.error} onRetry={res.reload} />}
      {dq && res.data && !res.data.people.length && <p className="py-4 text-center text-sm text-muted">Nobody matches “{dq}”.</p>}
      <ul className="space-y-2">
        {res.data?.people.map((p) => {
          const done = sessionId ? p.sessionCheckedIn : !!p.checkedInAt;
          return (
            <li key={p.userId} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white p-3">
              <div className="min-w-0"><p className="truncate font-semibold">{p.name}</p><p className="truncate text-sm text-muted">{p.email}</p><Badge className="mt-1">{p.ticketType}</Badge></div>
              {done ? <Badge tone="ok">Checked in ✓</Badge> : <Button variant="primary" busy={busy === p.userId} onClick={() => checkin(p)}>Check in</Button>}
            </li>
          );
        })}
      </ul>
      {!isAdmin && <Notice>Staff accounts can check people in but not undo check-ins. Ask an admin if one was a mistake.</Notice>}
    </div>
  );
}

function SessionStats({ stats, tz }: { stats: Stats | null; tz: string }) {
  if (!stats) return <ListSkeleton rows={3} />;
  if (!stats.sessions.length) return <p className="py-6 text-center text-sm text-muted">No published sessions.</p>;
  return (
    <ul className="space-y-2">
      {stats.sessions.map((s) => (
        <li key={s.id} className="rounded-lg border border-line bg-white p-3">
          <p className="text-xs text-muted tnum">{fmtTime(s.startsAt, tz)}</p><p className="font-semibold">{s.title}</p>
          <p className="mt-1 text-sm tnum"><strong>{s.checkedIn}</strong> in · {s.registered} registered{s.capacity ? ` of ${s.capacity}` : ''}{s.waitlisted ? ` · ${s.waitlisted} waitlisted` : ''}</p>
        </li>
      ))}
    </ul>
  );
}
