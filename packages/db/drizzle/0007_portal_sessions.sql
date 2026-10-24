CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"practice_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(48)
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "access_token" varchar(64);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_access_token_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_token_hash_uq" ON "portal_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_sessions_client_active_idx" ON "portal_sessions" USING btree ("practice_id","client_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "portal_sessions_expiry_idx" ON "portal_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_access_token_unique" UNIQUE("access_token");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_portal_access_token_state_check" CHECK ((
        "clients"."access_token" is null
        and "clients"."portal_access_token_expires_at" is null
        and "clients"."portal_access_token_used_at" is null
      ) or (
        "clients"."access_token" ~ '^[0-9a-f]{64}$'
        and "clients"."portal_access_token_expires_at" is not null
      ));