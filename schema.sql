CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  upi_id TEXT NOT NULL UNIQUE,
  mobile TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  payment_reference TEXT
);

CREATE TABLE IF NOT EXISTS bill_items (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS bill_recipients (
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2),
  PRIMARY KEY (bill_id, user_id)
);

CREATE INDEX IF NOT EXISTS bills_creator_idx ON bills(creator_id);
CREATE INDEX IF NOT EXISTS bill_recipients_user_idx ON bill_recipients(user_id);
