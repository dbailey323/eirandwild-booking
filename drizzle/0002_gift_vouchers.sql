CREATE TABLE "gift_vouchers" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"balance_pence" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_email" text NOT NULL,
	"recipient_name" text DEFAULT '' NOT NULL,
	"recipient_email" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"payment_method" text DEFAULT 'stripe' NOT NULL,
	"stripe_checkout_id" text,
	"stripe_payment_intent_id" text,
	"expires_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "gift_vouchers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "voucher_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" text NOT NULL,
	"booking_id" text,
	"pass_id" text,
	"amount_pence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "voucher_pence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_passes" ADD COLUMN "voucher_pence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucher_id_gift_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."gift_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voucher_redemptions_voucher_idx" ON "voucher_redemptions" USING btree ("voucher_id");