CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'checked_in', 'in_exam', 'checked_out', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"patient_id" uuid,
	"client_id" uuid,
	"doctor_id" uuid,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	CONSTRAINT "appointments_time_range_check" CHECK ("appointments"."start_time" < "appointments"."end_time")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_practice_id_uq" ON "appointments" USING btree ("practice_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_practice_patient_id_uq" ON "appointments" USING btree ("practice_id","id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_practice_patient_client_id_uq" ON "appointments" USING btree ("practice_id","id","patient_id","client_id");--> statement-breakpoint
CREATE INDEX "appointments_practice_time_idx" ON "appointments" USING btree ("practice_id","start_time","doctor_id");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "appointments_doctor_idx" ON "appointments" USING btree ("doctor_id","start_time");--> statement-breakpoint
CREATE INDEX "appointments_client_status_idx" ON "appointments" USING btree ("practice_id","client_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_status_idx" ON "appointments" USING btree ("practice_id","patient_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "appointments_doctor_status_idx" ON "appointments" USING btree ("practice_id","doctor_id","status","deleted_at");