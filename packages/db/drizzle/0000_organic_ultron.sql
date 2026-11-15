CREATE TYPE "public"."user_role" AS ENUM('admin', 'veterinarian', 'technician', 'front_desk', 'viewer');--> statement-breakpoint
CREATE TABLE "practices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"address" text,
	"phone" varchar(32),
	"email" varchar(255),
	"website" varchar(255),
	"timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"logo_url" varchar(512),
	"settings" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'front_desk' NOT NULL,
	"is_veterinarian" boolean DEFAULT false NOT NULL,
	"practice_id" uuid NOT NULL,
	"avatar_url" varchar(512),
	"license_number" varchar(64),
	"phone" varchar(32),
	"email_verified_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_practice_id_uq" ON "users" USING btree ("practice_id","id");--> statement-breakpoint
CREATE INDEX "users_practice_idx" ON "users" USING btree ("practice_id","deleted_at");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("practice_id","role");--> statement-breakpoint
CREATE INDEX "users_veterinarian_idx" ON "users" USING btree ("practice_id","is_veterinarian","deleted_at");