/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Interprets "YYYY-MM-DD HH:mm" (or with "T") as wall-clock time in `tz`. Returns null if unparseable. */
export function zonedToUtc(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffsetMs(tz, new Date(guess));
  t = guess - tzOffsetMs(tz, new Date(t)); // second pass handles DST boundaries
  const out = new Date(t);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** Parses an ISO timestamp with offset/Z, or a wall-clock string in the event's tz. */
export function parseWhen(value: string, tz: string): Date | null {
  const v = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return zonedToUtc(v, tz);
}

/** Start of the event's first day and end of its last day, as UTC instants. */
export function eventWindow(startDate: string, endDate: string, tz: string) {
  const start = zonedToUtc(`${startDate} 00:00`, tz)!;
  const end = new Date(zonedToUtc(`${endDate} 00:00`, tz)!.getTime() + 36 * 3600_000); // generous end: covers DST + late sessions
  const lastDayEnd = zonedToUtc(`${nextDay(endDate)} 00:00`, tz)!;
  return { start, end: lastDayEnd.getTime() < end.getTime() ? lastDayEnd : end };
}
const nextDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
