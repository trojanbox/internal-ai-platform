CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE FUNCTION "touch_business_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW.created_at = OLD.created_at;
  NEW.updated_at = CURRENT_TIMESTAMP(3);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "users_touch_updated_at"
  BEFORE UPDATE ON "users"
  FOR EACH ROW
  EXECUTE FUNCTION "touch_business_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "items_touch_updated_at"
  BEFORE UPDATE ON "items"
  FOR EACH ROW
  EXECUTE FUNCTION "touch_business_updated_at"();
