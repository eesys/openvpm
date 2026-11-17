CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sku" varchar(64),
	"category" varchar(128),
	"unit_price" numeric(10, 2) NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"cost_price" numeric(10, 2),
	"inventory_tracked" boolean DEFAULT true NOT NULL,
	"stock_quantity" numeric(13, 3) DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 10,
	"lot_number" varchar(64),
	"expiration_date" date,
	"external_source" varchar(64),
	"external_id" varchar(160),
	"import_fingerprint" varchar(64),
	CONSTRAINT "products_import_identity_check" CHECK (("products"."external_source" is null and "products"."external_id" is null and "products"."import_fingerprint" is null)
        or ("products"."external_source" is not null and "products"."external_id" is not null and "products"."import_fingerprint" is not null)),
	CONSTRAINT "products_import_fingerprint_check" CHECK ("products"."import_fingerprint" is null or "products"."import_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "products_external_source_check" CHECK ("products"."external_source" is null or "products"."external_source" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "products_inventory_tracking_check" CHECK ("products"."inventory_tracked" or (
        "products"."stock_quantity" = 0
        and "products"."reorder_point" is null
        and "products"."lot_number" is null
        and "products"."expiration_date" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"practice_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"adjustment" numeric(13, 3) NOT NULL,
	"quantity_after" numeric(13, 3) NOT NULL,
	"reason" text NOT NULL,
	"adjusted_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_practice_id_uq" ON "products" USING btree ("practice_id","id");--> statement-breakpoint
ALTER TABLE "inventory_stock_adjustments" ADD CONSTRAINT "inventory_stock_adjustments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_adjustments" ADD CONSTRAINT "inventory_stock_adjustments_adjusted_by_users_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_adjustments" ADD CONSTRAINT "inventory_stock_adjustments_practice_product_fk" FOREIGN KEY ("practice_id","product_id") REFERENCES "public"."products"("practice_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_practice_idx" ON "products" USING btree ("practice_id","deleted_at");--> statement-breakpoint
CREATE INDEX "products_practice_name_idx" ON "products" USING btree ("practice_id","deleted_at","name");--> statement-breakpoint
CREATE INDEX "products_sku_idx" ON "products" USING btree ("practice_id","sku");--> statement-breakpoint
CREATE INDEX "products_expiration_idx" ON "products" USING btree ("practice_id","expiration_date","deleted_at");--> statement-breakpoint
CREATE INDEX "products_stock_alert_idx" ON "products" USING btree ("practice_id","deleted_at","stock_quantity");--> statement-breakpoint
CREATE UNIQUE INDEX "products_external_id_uq" ON "products" USING btree ("practice_id","external_source","external_id") WHERE "products"."external_source" is not null and "products"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_import_fingerprint_uq" ON "products" USING btree ("practice_id","import_fingerprint") WHERE "products"."import_fingerprint" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_stock_adjustments_practice_operation_uq" ON "inventory_stock_adjustments" USING btree ("practice_id","operation_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_adjustments_product_idx" ON "inventory_stock_adjustments" USING btree ("practice_id","product_id","created_at");