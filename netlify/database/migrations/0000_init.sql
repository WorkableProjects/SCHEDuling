CREATE TYPE "public"."checkin_method" AS ENUM('qr', 'manual', 'self');--> statement-breakpoint
CREATE TYPE "public"."event_privacy" AS ENUM('public', 'invite_only', 'password');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('registered', 'waitlisted');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'speaker', 'attendee', 'checkin_staff');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('draft', 'published', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('activate', 'reset', 'invite');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'pending', 'disabled');--> statement-breakpoint
CREATE TABLE "agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"diff" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_in_event" text DEFAULT 'attendee' NOT NULL,
	"ticket_type" text DEFAULT 'General' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"qr_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"tz" text DEFAULT 'UTC' NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"location" text,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"privacy" "event_privacy" DEFAULT 'public' NOT NULL,
	"password_hash" text,
	"published" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{"allowConflicts":false,"directoryVisible":true,"selfCheckin":true,"speakerEdit":true,"showCapacityLabels":true,"scheduleFrozen":false}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"email" text NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer
);
--> statement-breakpoint
CREATE TABLE "session_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"method" "checkin_method" NOT NULL,
	"by_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "registration_status" DEFAULT 'registered' NOT NULL,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_speakers" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_speakers_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "session_tracks" (
	"session_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	CONSTRAINT "session_tracks_session_id_track_id_pk" PRIMARY KEY("session_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"room_id" uuid,
	"status" "session_status" DEFAULT 'draft' NOT NULL,
	"capacity" integer,
	"requires_registration" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#4f46e5' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'attendee' NOT NULL,
	"title" text,
	"org" text,
	"bio" text,
	"photo_key" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"ical_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_checkins" ADD CONSTRAINT "session_checkins_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_checkins" ADD CONSTRAINT "session_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_checkins" ADD CONSTRAINT "session_checkins_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_registrations" ADD CONSTRAINT "session_registrations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_registrations" ADD CONSTRAINT "session_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_speakers" ADD CONSTRAINT "session_speakers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_speakers" ADD CONSTRAINT "session_speakers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tracks" ADD CONSTRAINT "session_tracks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tracks" ADD CONSTRAINT "session_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agenda_pair_uq" ON "agenda_items" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "agenda_session_idx" ON "agenda_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "announcements_event_idx" ON "announcements" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_hash_uq" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_members_pair_uq" ON "event_members" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_members_qr_uq" ON "event_members" USING btree ("qr_token");--> statement-breakpoint
CREATE INDEX "event_members_user_idx" ON "event_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_uq" ON "events" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_pair_uq" ON "feedback" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","at");--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email","at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ott_hash_uq" ON "one_time_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ott_user_idx" ON "one_time_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rooms_event_idx" ON "rooms" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_name_uq" ON "rooms" USING btree ("event_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "session_checkin_pair_uq" ON "session_checkins" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "session_checkin_user_idx" ON "session_checkins" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_pair_uq" ON "session_registrations" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "registration_user_idx" ON "session_registrations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_speakers_user_idx" ON "session_speakers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_tracks_track_idx" ON "session_tracks" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "sessions_event_start_idx" ON "sessions" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE INDEX "sessions_room_idx" ON "sessions" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "tracks_event_idx" ON "tracks" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_name_uq" ON "tracks" USING btree ("event_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_ical_uq" ON "users" USING btree ("ical_token");