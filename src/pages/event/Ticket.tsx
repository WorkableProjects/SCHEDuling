import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useEvent } from '../../layouts/EventLayout';
import { fmtDateRange, fmtDateTime } from '../../lib/format';
import { Badge, Button, EmptyState, Notice, useToast } from '../../ui/kit';
import { useGate } from './parts';

export function Ticket() {
  const { data, reload } = useEvent();
  const { user } = useAuth();
  const toast = useToast();
  const gate = useGate();
  const [img, setImg] = useState('');
  const m = data!.membership;
  useEffect(() => { if (m) QRCode.toDataURL(`sched:${m.qrToken}`, { width: 320, margin: 1, errorCorrectionLevel: 'M' }).then(setImg).catch(() => setImg('')); }, [m?.qrToken]);
  if (gate) return gate;
  if (!m || !user) return <EmptyState title="No ticket yet">Join this event from the welcome page to get your check-in QR code.</EmptyState>;
  const ev = data!.event;
  async function selfCheckin() {
    try { const r = await post(`/api/checkin/${ev.id}/self`, {}); toast.ok(r.event.alreadyCheckedIn ? "You're already checked in" : "You're checked in. Welcome!"); await reload(); } catch (e) { toast.error(e); }
  }
  return (
    <div className="mx-auto max-w-sm">
      <div className="overflow-hidden rounded-xl border border-line bg-white text-center shadow-sm">
        <div className="bg-brand px-4 py-3 text-brand-ink"><p className="text-xs uppercase tracking-wide opacity-80">{ev.name}</p><p className="text-sm">{fmtDateRange(ev.startDate, ev.endDate)}</p></div>
        <div className="px-6 py-5">
          <p className="text-xl font-bold">{user.name}</p>
          <p className="mb-3 text-sm text-muted">{user.email}</p>
          {img ? <img src={img} alt="Your check-in QR code" width={256} height={256} className="mx-auto" /> : <div className="skeleton mx-auto size-64" />}
          <p className="mt-3"><Badge tone="brand">{m.ticketType}</Badge></p>
          <p className="mt-2 text-xs text-muted">Show this code to the check-in desk. Turn your screen brightness up.</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {m.checkedInAt ? <Notice tone="ok">Checked in {fmtDateTime(m.checkedInAt)} ✓</Notice> : ev.settings?.selfCheckin !== false && <Button variant="primary" className="w-full" onClick={selfCheckin}>I'm here — check me in</Button>}
        <p className="text-center text-xs text-muted">Self check-in for individual sessions is on each session's page, 30 minutes either side of the start.</p>
      </div>
    </div>
  );
}
