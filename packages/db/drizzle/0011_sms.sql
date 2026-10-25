CREATE TYPE "public"."messaging_registration_status" AS ENUM('not_started', 'pending', 'active', 'action_required', 'failed', 'suspended');--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text,
	"phone" varchar(32),
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_messaging" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"provider" varchar(16) DEFAULT 'telnyx' NOT NULL,
	"sender_e164" varchar(16),
	"registration_status" "messaging_registration_status" DEFAULT 'not_started' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "location_messaging_location_id_unique" UNIQUE("location_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "sms_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "provider_message_id" varchar(255);--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_messaging" ADD CONSTRAINT "location_messaging_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_messaging" ADD CONSTRAINT "location_messaging_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_practice_id_uq" ON "locations" USING btree ("practice_id","id");--> statement-breakpoint
CREATE INDEX "locations_practice_idx" ON "locations" USING btree ("practice_id","deleted_at");--> statement-breakpoint
CREATE INDEX "locations_primary_idx" ON "locations" USING btree ("practice_id","is_primary");--> statement-breakpoint
CREATE INDEX "location_messaging_practice_idx" ON "location_messaging" USING btree ("practice_id");--> statement-breakpoint
CREATE INDEX "location_messaging_sender_idx" ON "location_messaging" USING btree ("sender_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "location_messaging_practice_id_uq" ON "location_messaging" USING btree ("practice_id","id");