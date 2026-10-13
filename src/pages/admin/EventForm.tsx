import { useState, type FormEvent } from 'react';
import { slugify } from '../../lib/format';
import { Button, Check, Notice, SelectField, TextArea, TextField } from '../../ui/kit';

export type EventDto = {
  id?: string; slug: string; name: string; description: string | null; tz: string; startDate: string; endDate: string; location: string | null;
  branding: { primaryColor?: string; bannerText?: string; footerText?: string }; privacy: 'public' | 'invite_only' | 'password'; hasPassword?: boolean;
  settings: { allowConflicts: boolean; directoryVisible: boolean; selfCheckin: boolean; speakerEdit: boolean; showCapacityLabels: boolean; scheduleFrozen: boolean };
};
const today = () => new Date().toISOString().slice(0, 10);
const blank: EventDto = {
  slug: '', name: '', description: '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', startDate: today(), endDate: today(), location: '', branding: { primaryColor: '#1d5f8f' }, privacy: 'public',
  settings: { allowConflicts: false, directoryVisible: true, selfCheckin: true, speakerEdit: true, showCapacityLabels: true, scheduleFrozen: false },
};
const zones: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];

export function EventForm({ initial, onSave, submitLabel, creating }: { initial?: EventDto; onSave: (body: Record<string, unknown>) => Promise<void>; submitLabel: string; creating?: boolean }) {
  const [f, setF] = useState<EventDto>(initial ?? blank);
  const [password, setPassword] = useState('');
  const [slugTouched, setSlugTouched] = useState(!creating);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EventDto>(k: K, v: EventDto[K]) => setF((p) => ({ ...p, [k]: v }));
  const setting = (k: keyof EventDto['settings']) => (v: boolean) => setF((p) => ({ ...p, settings: { ...p.settings, [k]: v } }));

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await onSave({
        slug: f.slug, name: f.name, description: f.description || null, tz: f.tz, startDate: f.startDate, endDate: f.endDate, location: f.location || null,
        branding: Object.fromEntries(Object.entries(f.branding).filter(([, v]) => v)), privacy: f.privacy, ...(f.privacy === 'password' && password ? { password } : {}), settings: f.settings,
      });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      {error && <Notice tone="bad">{error}</Notice>}
      <section className="space-y-4 rounded-lg border border-line bg-white p-5" aria-labelledby="basics">
        <h2 id="basics" className="font-semibold">Basics</h2>
        <TextField label="Event name" required value={f.name} onChange={(e) => { set('name', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)); }} />
        <TextField label="Event URL" required value={f.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} hint={<>Your event will live at <code>/e/{f.slug || 'your-event'}</code></>} />
        <TextArea label="Description" value={f.description ?? ''} maxLength={5000} onChange={(e) => set('description', e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starts" type="date" required value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
          <TextField label="Ends" type="date" required value={f.endDate} min={f.startDate} onChange={(e) => set('endDate', e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Time zone" list="zones" required value={f.tz} onChange={(e) => set('tz', e.target.value)} hint="All session times are shown in this zone." />
          <datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          <TextField label="Location" value={f.location ?? ''} onChange={(e) => set('location', e.target.value)} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-line bg-white p-5" aria-labelledby="privacy">
        <h2 id="privacy" className="font-semibold">Who can see it</h2>
        <SelectField label="Access" value={f.privacy} onChange={(e) => set('privacy', e.target.value as EventDto['privacy'])}>
          <option value="public">Public: anyone can find, sign up and join</option>
          <option value="invite_only">Private, invite-only: only people you add or import</option>
          <option value="password">Password-protected: schedule needs a shared password</option>
        </SelectField>
        {f.privacy === 'password' && <TextField label="Event password" type="text" autoComplete="off" minLength={6} required={!f.hasPassword} value={password} onChange={(e) => setPassword(e.target.value)} hint={f.hasPassword ? 'Leave blank to keep the current password.' : 'At least 6 characters. Share it with attendees.'} />}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-white p-5" aria-labelledby="rules">
        <h2 id="rules" className="font-semibold">Rules</h2>
        <Check label="Allow overlapping registrations" hint="Off: attendees can't register for two sessions that overlap." checked={f.settings.allowConflicts} onChange={setting('allowConflicts')} />
        <Check label="Show capacity labels" hint="“Filling up”, “Nearly full” and “Full” appear on sessions with a capacity." checked={f.settings.showCapacityLabels} onChange={setting('showCapacityLabels')} />
        <Check label="Attendee directory" hint="Members can browse other attendees' names, titles and organizations." checked={f.settings.directoryVisible} onChange={setting('directoryVisible')} />
        <Check label="Self check-in" hint="Attendees can check themselves in from their phones (sessions: 30 minutes either side of the start)." checked={f.settings.selfCheckin} onChange={setting('selfCheckin')} />
        <Check label="Speakers can edit their own sessions" hint="Description and file uploads for sessions they're assigned to." checked={f.settings.speakerEdit} onChange={setting('speakerEdit')} />
        <Check label="Freeze the whole schedule" hint="Attendees can't add or remove anything. Admins can still enroll people." checked={f.settings.scheduleFrozen} onChange={setting('scheduleFrozen')} />
      </section>

      <section className="space-y-4 rounded-lg border border-line bg-white p-5" aria-labelledby="brand">
        <h2 id="brand" className="font-semibold">Branding</h2>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <TextField label="Accent color" type="color" value={f.branding.primaryColor ?? '#1d5f8f'} onChange={(e) => set('branding', { ...f.branding, primaryColor: e.target.value })} />
          <TextField label="Banner message" maxLength={200} value={f.branding.bannerText ?? ''} onChange={(e) => set('branding', { ...f.branding, bannerText: e.target.value })} hint="Optional strip shown above the event title." />
        </div>
        <TextField label="Footer text" maxLength={300} value={f.branding.footerText ?? ''} onChange={(e) => set('branding', { ...f.branding, footerText: e.target.value })} />
      </section>
      <Button type="submit" variant="primary" busy={busy}>{submitLabel}</Button>
    </form>
  );
}
