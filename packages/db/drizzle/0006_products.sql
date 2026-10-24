CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"inventory_tracked" boolean DEFAULT true NOT NULL,
	"stock_quantity" numeric(13, 3) DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 10,
	CONSTRAINT "products_inventory_tracking_check" CHECK ("products"."inventory_tracked" or (
        "products"."stock_quantity" = 0
        and "products"."reorder_point" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_practice_idx" ON "products" USING btree ("practice_id","deleted_at");--> statement-breakpoint
CREATE INDEX "products_practice_name_idx" ON "products" USING btree ("practice_id","deleted_at","name");--> statement-breakpoint
CREATE INDEX "products_stock_alert_idx" ON "products" USING btree ("practice_id","deleted_at","stock_quantity");--> statement-breakpoint
CREATE UNIQUE INDEX "products_practice_id_uq" ON "products" USING btree ("practice_id","id");