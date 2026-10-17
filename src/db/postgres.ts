import { Pool } from "pg";
import { env } from "../config/env";

export const pg = new Pool({ connectionString: env.POSTGRES_URL, max: 20 });

pg.on("error", (err) => console.error("[postgres] beklenmeyen havuz hatası:", err));

/** Şema idempotent'tir (IF NOT EXISTS); her açılışta güvenle çalıştırılabilir. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(32)  NOT NULL,
  email         VARCHAR(255),
  phone         VARCHAR(20),
  password_hash TEXT,
  public_key    TEXT,
  display_name  VARCHAR(64),
  avatar_url    TEXT,
  settings      JSONB        NOT NULL DEFAULT '{"liquidGlass":false,"theme":"system","font":"inter","invisibleMode":false}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_contact_chk CHECK (email IS NOT NULL OR phone IS NOT NULL OR password_hash IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq    ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uq    ON users (phone)        WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS chats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       VARCHAR(10) NOT NULL CHECK (type IN ('direct','group','channel')),
  title      VARCHAR(128),
  owner_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id   UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('admin','moderator','member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members (user_id);

ALTER TABLE chats ADD COLUMN IF NOT EXISTS disappear_seconds INTEGER
  CHECK (disappear_seconds IS NULL OR disappear_seconds IN (5, 60, 3600, 86400));
`;

export async function migratePostgres(): Promise<void> {
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
