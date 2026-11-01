CREATE TABLE "customer_login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customer_passes" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"pass_type_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credits_total" integer,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"amount_pence" integer NOT NULL,
	"refunded_pence" integer DEFAULT 0 NOT NULL,
	"payment_method" text DEFAULT 'stripe' NOT NULL,
	"stripe_checkout_id" text,
	"stripe_payment_intent_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pass_type_classes" (
	"pass_type_id" integer NOT NULL,
	"class_type_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pass_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_pence" integer NOT NULL,
	"credits" integer,
	"validity" text DEFAULT 'days' NOT NULL,
	"validity_days" integer,
	"valid_from" text,
	"valid_until" text,
	"on_sale" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pass_id" text;--> statement-breakpoint
ALTER TABLE "customer_login_tokens" ADD CONSTRAINT "customer_login_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_passes" ADD CONSTRAINT "customer_passes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_passes" ADD CONSTRAINT "customer_passes_pass_type_id_pass_types_id_fk" FOREIGN KEY ("pass_type_id") REFERENCES "public"."pass_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_type_classes" ADD CONSTRAINT "pass_type_classes_pass_type_id_pass_types_id_fk" FOREIGN KEY ("pass_type_id") REFERENCES "public"."pass_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_type_classes" ADD CONSTRAINT "pass_type_classes_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_passes_customer_idx" ON "customer_passes" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pass_type_classes_idx" ON "pass_type_classes" USING btree ("pass_type_id","class_type_id");