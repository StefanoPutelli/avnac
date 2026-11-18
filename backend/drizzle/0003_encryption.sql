-- Envelope encryption: each user's data key, locked by their password and by the admin key.
CREATE TABLE IF NOT EXISTS "user_key" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "salt" text NOT NULL,
  "iterations" integer NOT NULL,
  "password_wrapped" text NOT NULL,
  "admin_wrapped" text,
  "reset_wrapped" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Single admin key pair; the private key is locked with the admin's data key.
CREATE TABLE IF NOT EXISTS "admin_key" (
  "id" integer PRIMARY KEY NOT NULL CHECK ("id" = 1),
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "public_key" text NOT NULL,
  "private_wrapped" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Documents are stored as one encrypted blob; plaintext columns stay only on legacy rows
-- until their owner signs in and the browser re-uploads them encrypted.
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "encrypted" text;
ALTER TABLE "document" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "document" ALTER COLUMN "document" DROP NOT NULL;
ALTER TABLE "document" ALTER COLUMN "vector_boards" DROP NOT NULL;
ALTER TABLE "document" ALTER COLUMN "vector_board_docs" DROP NOT NULL;
