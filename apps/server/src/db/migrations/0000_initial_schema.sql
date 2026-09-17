CREATE TABLE "member_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint,
	"username" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	CONSTRAINT "member_invites_identifies_someone" CHECK ("member_invites"."telegram_id" is not null or "member_invites"."username" is not null)
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"display_name" text NOT NULL,
	"language" text DEFAULT 'ca' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_language_check" CHECK ("members"."language" in ('ca', 'es')),
	CONSTRAINT "members_role_check" CHECK ("members"."role" in ('member', 'admin')),
	CONSTRAINT "members_status_check" CHECK ("members"."status" in ('pending', 'approved', 'rejected', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "catalog_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"content_hash" text,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"archived" integer DEFAULT 0 NOT NULL,
	"resolved_pending" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggered_by" uuid,
	CONSTRAINT "catalog_syncs_status_check" CHECK ("catalog_syncs"."status" in ('ok', 'partial', 'failed')),
	CONSTRAINT "catalog_syncs_trigger_check" CHECK ("catalog_syncs"."trigger" in ('schedule', 'manual', 'command')),
	CONSTRAINT "catalog_syncs_source_check" CHECK ("catalog_syncs"."source" in ('sheets', 'csv'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_es" text,
	"unit_code" text NOT NULL,
	"price_cents" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"category" text,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'sheet' NOT NULL,
	"proposed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_status_check" CHECK ("products"."status" in ('active', 'archived', 'pending')),
	CONSTRAINT "products_source_check" CHECK ("products"."source" in ('sheet', 'member')),
	CONSTRAINT "products_price_check" CHECK ("products"."price_cents" is null or "products"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"name_ca" text NOT NULL,
	"name_es" text NOT NULL,
	"allows_decimals" boolean NOT NULL,
	"step" numeric(10, 2) NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "units_code_check" CHECK ("units"."code" in ('kg', 'unit', 'box', 'bunch', 'dozen', 'litre'))
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"note" text,
	"available_until" date,
	"status" text DEFAULT 'active' NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nudged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_status_check" CHECK ("offers"."status" in ('active', 'withdrawn', 'expired')),
	CONSTRAINT "offers_quantity_check" CHECK ("offers"."quantity" >= 0),
	CONSTRAINT "offers_note_length_check" CHECK ("offers"."note" is null or length("offers"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"producer_id" uuid NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_price_cents" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"closed_by" uuid,
	"expires_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" in ('pending', 'confirmed', 'delivered', 'rejected', 'cancelled', 'expired')),
	CONSTRAINT "reservations_quantity_check" CHECK ("reservations"."quantity" > 0),
	CONSTRAINT "reservations_price_check" CHECK ("reservations"."unit_price_cents" is null or "reservations"."unit_price_cents" >= 0),
	CONSTRAINT "reservations_parties_differ" CHECK ("reservations"."requester_id" <> "reservations"."producer_id"),
	CONSTRAINT "reservations_reason_length_check" CHECK ("reservations"."reason" is null or length("reservations"."reason") <= 200)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_kind_check" CHECK ("messages"."kind" in ('text', 'system')),
	CONSTRAINT "messages_body_length_check" CHECK (length("messages"."body") between 1 and 2000),
	CONSTRAINT "messages_sender_check" CHECK ("messages"."kind" = 'system' or "messages"."sender_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "thread_reads" (
	"reservation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_reads_reservation_id_member_id_pk" PRIMARY KEY("reservation_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"telegram_message_id" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10', 'N11', 'N12')),
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" in ('queued', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "settings_key_check" CHECK ("settings"."key" in ('reservation_expiry_hours', 'reservation_reminder_hours_before_expiry', 'offer_nudge_days', 'offer_stale_days_after_nudge', 'thread_readonly_days_after_close', 'notify_new_offer'))
);
--> statement-breakpoint
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_used_by_members_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_approved_by_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_syncs" ADD CONSTRAINT "catalog_syncs_triggered_by_members_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "public"."units"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_proposed_by_members_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_producer_id_members_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_requester_id_members_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_producer_id_members_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_closed_by_members_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_members_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_last_read_message_id_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_invites_telegram_id_key" ON "member_invites" USING btree ("telegram_id") WHERE "member_invites"."telegram_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "member_invites_username_key" ON "member_invites" USING btree ("username") WHERE "member_invites"."username" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_telegram_id_key" ON "members" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "members_status_idx" ON "members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "catalog_syncs_started_at_idx" ON "catalog_syncs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_key" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_active_per_producer_product" ON "offers" USING btree ("producer_id","product_id") WHERE "offers"."status" = 'active';--> statement-breakpoint
CREATE INDEX "offers_status_available_until_idx" ON "offers" USING btree ("status","available_until");--> statement-breakpoint
CREATE INDEX "offers_producer_idx" ON "offers" USING btree ("producer_id","status");--> statement-breakpoint
CREATE INDEX "reservations_offer_status_idx" ON "reservations" USING btree ("offer_id","status");--> statement-breakpoint
CREATE INDEX "reservations_requester_status_idx" ON "reservations" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX "reservations_producer_status_idx" ON "reservations" USING btree ("producer_id","status");--> statement-breakpoint
CREATE INDEX "reservations_status_expires_at_idx" ON "reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "messages_reservation_created_at_idx" ON "messages" USING btree ("reservation_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_member_idx" ON "notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications" USING btree ("dedupe_key") WHERE "notifications"."dedupe_key" is not null;