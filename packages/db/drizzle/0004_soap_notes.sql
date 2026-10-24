CREATE TYPE "public"."soap_note_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TABLE "soap_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"author_id" uuid NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"status" "soap_note_status" DEFAULT 'finalized' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"finalizer_name" varchar(255),
	"subjective" text,
	"objective" text,
	"assessment" text,
	"plan" text,
	CONSTRAINT "soap_notes_revision_check" CHECK ("soap_notes"."revision" >= 1),
	CONSTRAINT "soap_notes_author_name_check" CHECK (length(btrim("soap_notes"."author_name")) between 1 and 255),
	CONSTRAINT "soap_notes_lifecycle_check" CHECK ((
        "soap_notes"."status" = 'draft'
        and "soap_notes"."finalized_at" is null
        and "soap_notes"."finalized_by" is null
        and "soap_notes"."finalizer_name" is null
      ) or (
        "soap_notes"."status" = 'finalized'
        and "soap_notes"."finalized_at" is not null
        and "soap_notes"."finalized_by" is not null
        and length(btrim("soap_notes"."finalizer_name")) between 1 and 255
      ))
);
--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soap_notes" ADD CONSTRAINT "soap_notes_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soap_notes_patient_idx" ON "soap_notes" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "soap_notes_practice_record_uq" ON "soap_notes" USING btree ("practice_id","id");--> statement-breakpoint
CREATE INDEX "soap_notes_practice_idx" ON "soap_notes" USING btree ("practice_id","deleted_at");--> statement-breakpoint
CREATE INDEX "soap_notes_appointment_idx" ON "soap_notes" USING btree ("practice_id","appointment_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "soap_notes_active_appointment_draft_uq" ON "soap_notes" USING btree ("practice_id","appointment_id") WHERE "soap_notes"."status" = 'draft' and "soap_notes"."appointment_id" is not null and "soap_notes"."deleted_at" is null;