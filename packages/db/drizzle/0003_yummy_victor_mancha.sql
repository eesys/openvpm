CREATE TYPE "public"."appointment_origin" AS ENUM('scheduled', 'field');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'checked_in', 'in_exam', 'checked_out', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('exam', 'surgery', 'treatment', 'boarding');--> statement-breakpoint
CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"color" varchar(7) DEFAULT '#0d9488',
	"requires_doctor" integer DEFAULT 1 NOT NULL,
	"default_room_type" "room_type" DEFAULT 'exam'
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"type_id" uuid,
	"patient_id" uuid,
	"client_id" uuid,
	"doctor_id" uuid,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"origin" "appointment_origin" DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	CONSTRAINT "appointments_time_range_check" CHECK ("appointments"."start_time" < "appointments"."end_time")
);
--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_type_id_appointment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."appointment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_types_practice_name_idx" ON "appointment_types" USING btree ("practice_id","deleted_at","name");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_practice_id_uq" ON "appointments" USING btree ("practice_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_practice_patient_id_uq" ON "appointments" USING btree ("practice_id","id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_practice_patient_client_id_uq" ON "appointments" USING btree ("practice_id","id","patient_id","client_id");--> statement-breakpoint
CREATE INDEX "appointments_practice_time_idx" ON "appointments" USING btree ("practice_id","start_time","doctor_id");--> statement-breakpoint
CREATE INDEX "appointments_conversion_created_idx" ON "appointments" USING btree ("practice_id","created_at","id");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "appointments_doctor_idx" ON "appointments" USING btree ("doctor_id","start_time");--> statement-breakpoint
CREATE INDEX "appointments_client_status_idx" ON "appointments" USING btree ("practice_id","client_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_status_idx" ON "appointments" USING btree ("practice_id","patient_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "appointments_doctor_status_idx" ON "appointments" USING btree ("practice_id","doctor_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "appointments_type_status_idx" ON "appointments" USING btree ("practice_id","type_id","status","deleted_at");