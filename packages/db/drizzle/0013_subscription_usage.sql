CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"period_month" varchar(7) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "subscription_tier" varchar(32) DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "billing_status" varchar(24) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_practice_period_idx" ON "usage_records" USING btree ("practice_id","period_month");