CREATE TYPE "public"."contact_method" AS ENUM('phone', 'email', 'sms', 'portal');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('active', 'inactive', 'deceased');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female', 'male_neutered', 'female_spayed');--> statement-breakpoint
CREATE TYPE "public"."species" AS ENUM('canine', 'feline', 'avian', 'rabbit', 'reptile', 'equine', 'bovine', 'ovine', 'caprine', 'porcine', 'poultry', 'camelid', 'other');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"first_name" varchar(128) NOT NULL,
	"last_name" varchar(128) NOT NULL,
	"email" varchar(255),
	"phone" varchar(32),
	"address" text,
	"city" varchar(128),
	"state" varchar(64),
	"zip" varchar(16),
	"emergency_contact" varchar(255),
	"emergency_phone" varchar(32),
	"preferred_contact_method" "contact_method" DEFAULT 'phone',
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"species" "species" NOT NULL,
	"breed" varchar(128),
	"sex" "sex",
	"dob" date,
	"color" varchar(64),
	"microchip_number" varchar(64),
	"photo_url" varchar(512),
	"status" "patient_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_practice_id_uq" ON "clients" USING btree ("practice_id","id");--> statement-breakpoint
CREATE INDEX "clients_practice_idx" ON "clients" USING btree ("practice_id","deleted_at");--> statement-breakpoint
CREATE INDEX "clients_email_idx" ON "clients" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_practice_id_uq" ON "patients" USING btree ("practice_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_practice_client_id_uq" ON "patients" USING btree ("practice_id","id","client_id");--> statement-breakpoint
CREATE INDEX "patients_practice_idx" ON "patients" USING btree ("practice_id","deleted_at");--> statement-breakpoint
CREATE INDEX "patients_client_idx" ON "patients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "patients_name_idx" ON "patients" USING btree ("name");