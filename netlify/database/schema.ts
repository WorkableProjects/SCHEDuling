import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, uuid, text, boolean, integer, timestamp, jsonb, uniqueIndex, index, primaryKey,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('user_role', ['admin', 'speaker', 'attendee', 'checkin_staff']);
export const userStatusEnum = pgEnum('user_status', ['active', 'pending', 'disabled']);
export const privacyEnum = pgEnum('event_privacy', ['public', 'invite_only', 'password']);
export const sessionStatusEnum = pgEnum('session_status', ['draft', 'published', 'cancelled']);
export const regStatusEnum = pgEnum('registration_status', ['registered', 'waitlisted']);
export const checkinMethodEnum = pgEnum('checkin_method', ['qr', 'manual', 'self']);
export const tokenPurposeEnum = pgEnum('token_purpose', ['activate', 'reset', 'invite']);

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('attendee'),
  title: text('title'),
  org: text('org'),
  bio: text('bio'),
  photoKey: text('photo_key'),
  status: userStatusEnum('status').notNull().default('active'),
  icalToken: text('ical_token').notNull().default(sql`replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')`),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`), uniqueIndex('users_ical_uq').on(t.icalToken)]);

export const authSessions = pgTable('auth_sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('auth_sessions_hash_uq').on(t.tokenHash), index('auth_sessions_user_idx').on(t.userId)]);

export const oneTimeTokens = pgTable('one_time_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  purpose: tokenPurposeEnum('purpose').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('ott_hash_uq').on(t.tokenHash), index('ott_user_idx').on(t.userId)]);

export const loginAttempts = pgTable('login_attempts', {
  id: id(),
  ip: text('ip').notNull(),
  email: text('email').notNull(),
  success: boolean('success').notNull().default(false),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('login_attempts_ip_idx').on(t.ip, t.at), index('login_attempts_email_idx').on(t.email, t.at)]);

export type EventSettings = {
  allowConflicts: boolean;
  directoryVisible: boolean;
  selfCheckin: boolean;
  speakerEdit: boolean;
  showCapacityLabels: boolean;
  scheduleFrozen: boolean;
};
export type EventBranding = { primaryColor?: string; bannerText?: string; footerText?: string };

export const events = pgTable('events', {
  id: id(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  tz: text('tz').notNull().default('UTC'),
  startDate: text('start_date').notNull(), // YYYY-MM-DD in event tz
  endDate: text('end_date').notNull(),
  location: text('location'),
  branding: jsonb('branding').$type<EventBranding>().notNull().default({}),
  privacy: privacyEnum('privacy').notNull().default('public'),
  passwordHash: text('password_hash'),
  published: boolean('published').notNull().default(false),
  archived: boolean('archived').notNull().default(false),
  settings: jsonb('settings').$type<EventSettings>().notNull().default({
    allowConflicts: false, directoryVisible: true, selfCheckin: true, speakerEdit: true, showCapacityLabels: true, scheduleFrozen: false,
  }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('events_slug_uq').on(sql`lower(${t.slug})`)]);

export const eventMembers = pgTable('event_members', {
  id: id(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleInEvent: text('role_in_event').notNull().default('attendee'), // attendee | speaker
  ticketType: text('ticket_type').notNull().default('General'),
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  qrToken: text('qr_token').notNull().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('event_members_pair_uq').on(t.eventId, t.userId),
  uniqueIndex('event_members_qr_uq').on(t.qrToken),
  index('event_members_user_idx').on(t.userId),
]);

export const tracks = pgTable('tracks', {
  id: id(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#4f46e5'),
}, (t) => [index('tracks_event_idx').on(t.eventId), uniqueIndex('tracks_name_uq').on(t.eventId, t.name)]);

export const rooms = pgTable('rooms', {
  id: id(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  capacity: integer('capacity'),
}, (t) => [index('rooms_event_idx').on(t.eventId), uniqueIndex('rooms_name_uq').on(t.eventId, t.name)]);

export const sessions = pgTable('sessions', {
  id: id(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
  status: sessionStatusEnum('status').notNull().default('draft'),
  capacity: integer('capacity'),
  requiresRegistration: boolean('requires_registration').notNull().default(false),
  pinned: boolean('pinned').notNull().default(false),
  frozen: boolean('frozen').notNull().default(false),
  materials: jsonb('materials').$type<{ key: string; name: string; size: number }[]>().notNull().default([]),
  createdAt: createdAt(),
}, (t) => [index('sessions_event_start_idx').on(t.eventId, t.startsAt), index('sessions_room_idx').on(t.roomId)]);

export const sessionTracks = pgTable('session_tracks', {
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.sessionId, t.trackId] }), index('session_tracks_track_idx').on(t.trackId)]);

export const sessionSpeakers = pgTable('session_speakers', {
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.sessionId, t.userId] }), index('session_speakers_user_idx').on(t.userId)]);

export const agendaItems = pgTable('agenda_items', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('agenda_pair_uq').on(t.userId, t.sessionId), index('agenda_session_idx').on(t.sessionId)]);

export const sessionRegistrations = pgTable('session_registrations', {
  id: id(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: regStatusEnum('status').notNull().default('registered'),
  position: integer('position'), // waitlist order
  createdAt: createdAt(),
}, (t) => [uniqueIndex('registration_pair_uq').on(t.sessionId, t.userId), index('registration_user_idx').on(t.userId)]);

export const sessionCheckins = pgTable('session_checkins', {
  id: id(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  method: checkinMethodEnum('method').notNull(),
  byUserId: uuid('by_user_id').references(() => users.id, { onDelete: 'set null' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('session_checkin_pair_uq').on(t.sessionId, t.userId), index('session_checkin_user_idx').on(t.userId)]);

export const announcements = pgTable('announcements', {
  id: id(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('announcements_event_idx').on(t.eventId)]);

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // announcement | session_change | session_cancelled | waitlist | promoted | reminder
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  dedupeKey: text('dedupe_key'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt), uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey)]);

export const feedback = pgTable('feedback', {
  id: id(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('feedback_pair_uq').on(t.sessionId, t.userId)]);

export const auditLog = pgTable('audit_log', {
  id: id(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  diff: jsonb('diff'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_at_idx').on(t.at)]);
