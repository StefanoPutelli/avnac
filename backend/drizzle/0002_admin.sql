-- Better Auth admin plugin fields.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ban_reason" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ban_expires" timestamp with time zone;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonated_by" text;

-- Deleting a user deletes their documents (was ON DELETE SET NULL, which left them unreachable).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_owner_user_id_fkey' AND confdeltype <> 'c'
  ) THEN
    ALTER TABLE "document" DROP CONSTRAINT "document_owner_user_id_fkey";
    ALTER TABLE "document" ADD CONSTRAINT "document_owner_user_id_fkey"
      FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;
