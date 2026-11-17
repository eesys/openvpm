CREATE TYPE "public"."invoice_item_type" AS ENUM('service', 'product');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"invoice_id" uuid NOT NULL,
	"description" varchar(500) NOT NULL,
	"quantity" numeric(13, 3) DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"item_type" "invoice_item_type" NOT NULL,
	"item_id" uuid
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"patient_id" uuid,
	"appointment_id" uuid,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(10, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"due_date" date,
	"is_estimate" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(32),
	"category" varchar(128),
	"default_price" numeric(10, 2) NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"external_source" varchar(64),
	"external_id" varchar(160),
	"import_fingerprint" varchar(64),
	CONSTRAINT "services_default_price_nonnegative" CHECK ("services"."default_price" >= 0),
	CONSTRAINT "services_import_identity_check" CHECK (("services"."external_source" is null and "services"."external_id" is null and "services"."import_fingerprint" is null)
        or ("services"."external_source" is not null and "services"."external_id" is not null and "services"."import_fingerprint" is not null)),
	CONSTRAINT "services_import_fingerprint_check" CHECK ("services"."import_fingerprint" is null or "services"."import_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "services_external_source_check" CHECK ("services"."external_source" is null or "services"."external_source" ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id","deleted_at");--> statement-breakpoint
CREATE INDEX "invoice_items_item_idx" ON "invoice_items" USING btree ("item_type","deleted_at","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_items_invoice_item_target_uq" ON "invoice_items" USING btree ("invoice_id","id");--> statement-breakpoint
CREATE INDEX "invoices_practice_idx" ON "invoices" USING btree ("practice_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "invoices" USING btree ("practice_id","client_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "invoices_patient_idx" ON "invoices" USING btree ("practice_id","patient_id","client_id","deleted_at");--> statement-breakpoint
CREATE INDEX "invoices_appointment_idx" ON "invoices" USING btree ("practice_id","appointment_id","deleted_at","is_estimate","status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_active_appointment_uq" ON "invoices" USING btree ("practice_id","appointment_id") WHERE "invoices"."appointment_id" is not null
          and "invoices"."is_estimate" = false
          and "invoices"."status" <> 'void'
          and "invoices"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_visit_target_uq" ON "invoices" USING btree ("practice_id","appointment_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_practice_id_uq" ON "invoices" USING btree ("practice_id","id");--> statement-breakpoint
CREATE INDEX "services_practice_name_idx" ON "services" USING btree ("practice_id","deleted_at","name");--> statement-breakpoint
CREATE UNIQUE INDEX "services_practice_id_uq" ON "services" USING btree ("practice_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_external_id_uq" ON "services" USING btree ("practice_id","external_source","external_id") WHERE "services"."external_source" is not null and "services"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "services_import_fingerprint_uq" ON "services" USING btree ("practice_id","import_fingerprint") WHERE "services"."import_fingerprint" is not null;