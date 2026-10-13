import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { get } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { Button, ErrorState, ListSkeleton } from '../../ui/kit';

type A = { userId: string; name: string; email: string; role: string; ticketType: string; qrToken: string };

/** Printable name badges (2 per row) with QR codes the check-in scanner understands. */
export function Badges() {
  const { id = '' } = useParams();
  const q = useQuery(async () => ({ ev: (await get(`/api/events/${id}`)).event, a: (await get<{ attendees: A[] }>(`/api/people/attendees?eventId=${id}`)).attendees }), [id]);
  const [qr, setQr] = useState<Record<string, string>>({});
  useEffect(() => { (async () => { const out: Record<string, string> = {}; for (const a of q.data?.a ?? []) out[a.userId] = await QRCode.toDataURL(`sched:${a.qrToken}`, { width: 220, margin: 0 }); setQr(out); })(); }, [q.data]);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  return (
    <div>
      <div className="no-print mb-4 flex items-center gap-3"><Link className="text-sm text-brand underline" to={`/admin/events/${id}/checkin`}>← Check-in</Link><Button variant="primary" onClick={() => window.print()}>Print {q.data.a.length} badges</Button></div>
      <div className="badge-sheet grid gap-0 sm:grid-cols-2">
        {q.data.a.map((a) => (
          <div key={a.userId} className="badge flex h-[3.5in] flex-col items-center justify-between border border-dashed border-slate-400 bg-white p-5 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">{q.data!.ev.name}</p>
            <div><p className="text-3xl font-bold leading-tight">{a.name}</p><p className="mt-1 text-sm text-muted">{a.role === 'speaker' ? 'SPEAKER' : a.ticketType}</p></div>
            {qr[a.userId] ? <img src={qr[a.userId]} alt={`QR code for ${a.name}`} width={110} height={110} /> : <div className="size-[110px]" />}
          </div>
        ))}
      </div>
    </div>
  );
}
