import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z.string().min(10, 'Use at least 10 characters').max(200);
export const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only').min(2).max(60);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const signupSchema = z.object({ name: z.string().trim().min(1).max(100), email, password });
export const activateSchema = z.object({ token: z.string().min(10).max(200), password, name: z.string().trim().min(1).max(100).optional() });
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  title: optText(120), org: optText(120), bio: optText(2000),
});
export const changePasswordSchema = z.object({ current: z.string().min(1).max(200), next: password });
export const setupSchema = z.object({ token: z.string().min(1).max(300), emails: z.array(email).length(2) })
  .refine((v) => new Set(v.emails).size === 2, { message: 'The two admin emails must differ', path: ['emails'] });

export const eventSettingsSchema = z.object({
  allowConflicts: z.boolean(), directoryVisible: z.boolean(), selfCheckin: z.boolean(),
  speakerEdit: z.boolean(), showCapacityLabels: z.boolean(), scheduleFrozen: z.boolean(),
});
export const eventBaseSchema = z.object({
  slug, name: z.string().trim().min(2).max(120), description: optText(5000),
  tz: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown time zone'),
  startDate: dateStr, endDate: dateStr, location: optText(200),
  branding: z.object({ primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), bannerText: z.string().max(200).optional(), footerText: z.string().max(300).optional() }).default({}),
  privacy: z.enum(['public', 'invite_only', 'password']),
  password: z.string().min(6).max(100).optional(),
  settings: eventSettingsSchema.partial().optional(),
});
export const eventInputSchema = eventBaseSchema.refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after start date', path: ['endDate'] });

export const trackSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4f46e5') });
export const roomSchema = z.object({ name: z.string().trim().min(1).max(80), capacity: z.number().int().min(1).max(100000).nullish().transform((v) => v ?? null) });

export const sessionInputSchema = z.object({
  eventId: uuid,
  title: z.string().trim().min(1).max(200),
  description: optText(10000),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  roomId: uuid.nullish().transform((v) => v ?? null),
  status: z.enum(['draft', 'published', 'cancelled']).default('draft'),
  capacity: z.number().int().min(1).max(100000).nullish().transform((v) => v ?? null),
  requiresRegistration: z.boolean().default(false),
  pinned: z.boolean().default(false),
  frozen: z.boolean().default(false),
  trackIds: z.array(uuid).max(20).default([]),
  speakerIds: z.array(uuid).max(30).default([]),
}).refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'End must be after start', path: ['endsAt'] });

export const speakerCreateSchema = z.object({
  eventId: uuid, name: z.string().trim().min(1).max(100), email,
  title: optText(120), org: optText(120), bio: optText(2000),
});
export const attendeeCreateSchema = z.object({
  eventId: uuid, name: z.string().trim().min(1).max(100), email,
  ticketType: z.string().trim().min(1).max(60).default('General'),
});
export const roleChangeSchema = z.object({ role: z.enum(['admin', 'speaker', 'attendee', 'checkin_staff']) });
export const announcementSchema = z.object({ title: z.string().trim().min(1).max(150), body: z.string().trim().min(1).max(5000) });
export const feedbackSchema = z.object({ rating: z.number().int().min(1).max(5), comment: optText(2000) });
export const scanSchema = z.object({ qrToken: z.string().min(8).max(200), sessionId: uuid.optional() });
export const manualCheckinSchema = z.object({ userId: uuid, sessionId: uuid.optional() });
export const selfCheckinSchema = z.object({ sessionId: uuid.optional() });
export const unlockSchema = z.object({ password: z.string().min(1).max(100) });
