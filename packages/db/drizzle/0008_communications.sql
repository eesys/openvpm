CREATE TYPE "public"."comm_channel" AS ENUM('phone', 'sms', 'email', 'portal');--> statement-breakpoint
CREATE TYPE "public"."comm_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."comm_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"client_id" uuid,
	"channel" "comm_channel" NOT NULL,
	"direction" "comm_direction" NOT NULL,
	"subject" varchar(255),
	"content" text,
	"status" "comm_status" DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "communications_practice_id_uq" ON "communications" USING btree ("practice_id","id");--> statement-breakpoint
CREATE INDEX "communications_practice_list_idx" ON "communications" USING btree ("practice_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "communications_client_timeline_idx" ON "communications" USING btree ("practice_id","client_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "communications_inbox_status_idx" ON "communications" USING btree ("practice_id","direction","status","deleted_at");--> statement-breakpoint
CREATE INDEX "communications_assigned_idx" ON "communications" USING btree ("practice_id","assigned_to","deleted_at");