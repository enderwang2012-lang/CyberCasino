import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;

export const sql = DATABASE_URL
  ? postgres(DATABASE_URL, { max: 10 })
  : null;

export async function ensureSchema() {
  if (!sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      user_id   TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      avatar    TEXT NOT NULL,
      provider  TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS agents_v2 (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      name            TEXT NOT NULL,
      avatar          TEXT NOT NULL,
      description     TEXT,
      strategy        JSONB NOT NULL,
      soul_key        TEXT,
      webhook_url     TEXT,
      webhook_verified BOOLEAN DEFAULT FALSE,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL
    )`;

  await sql`CREATE INDEX IF NOT EXISTS idx_agents_v2_user ON agents_v2(user_id)`;
}
