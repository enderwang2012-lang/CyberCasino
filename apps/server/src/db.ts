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
      strategy_package JSONB,
      strategy_versions JSONB,
      strategy_version INTEGER DEFAULT 1,
      execution_mode  TEXT DEFAULT 'remote_agent',
      soul_key        TEXT,
      style_prompt    TEXT DEFAULT '',
      style_profile   JSONB,
      pending_style_prompt TEXT,
      pending_style_profile JSONB,
      pending_strategy_version INTEGER,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL
    )`;

  await sql`CREATE INDEX IF NOT EXISTS idx_agents_v2_user ON agents_v2(user_id)`;

  // Add style_prompt column if it doesn't exist
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS style_prompt TEXT DEFAULT ''`;
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS style_profile JSONB`;
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS pending_style_prompt TEXT`;
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS pending_style_profile JSONB`;
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS pending_strategy_version INTEGER`;
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS strategy_package JSONB`;
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS strategy_versions JSONB`;
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS strategy_version INTEGER DEFAULT 1`;
  await sql`ALTER TABLE agents_v2 ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'remote_agent'`;
  await sql`ALTER TABLE agents_v2 ALTER COLUMN execution_mode SET DEFAULT 'remote_agent'`;
  await sql`ALTER TABLE agents_v2 DROP COLUMN IF EXISTS webhook_url`;
  await sql`ALTER TABLE agents_v2 DROP COLUMN IF EXISTS webhook_verified`;

  await sql`
    CREATE TABLE IF NOT EXISTS game_history (
      table_id    TEXT PRIMARY KEY,
      table_info  JSONB NOT NULL,
      event_history JSONB NOT NULL,
      created_at  BIGINT NOT NULL
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS match_action_audits (
      table_id     TEXT PRIMARY KEY,
      action_audits JSONB NOT NULL,
      created_at   BIGINT NOT NULL
    )`;
}
