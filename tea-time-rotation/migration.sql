-- drink_prices table
CREATE TABLE drink_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drink_type TEXT NOT NULL,
  sugar_level TEXT NOT NULL,
  price INTEGER NOT NULL,
  UNIQUE (drink_type, sugar_level)
);

-- Seed data
INSERT INTO drink_prices (drink_type, sugar_level, price) VALUES
  ('Tea', 'No Sugar', 24),
  ('*', '*', 20);

-- Add cost columns to users
ALTER TABLE users ADD COLUMN total_cost_sponsored INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN total_cost_consumed INTEGER NOT NULL DEFAULT 0;

-- Backfill existing data
UPDATE users SET
  total_cost_consumed = drink_count * 20,
  total_cost_sponsored = total_drinks_bought * 20;

-- New RPC functions
CREATE OR REPLACE FUNCTION increment_total_cost_sponsored(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
  UPDATE users SET total_cost_sponsored = total_cost_sponsored + p_amount WHERE id = p_user_id;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION increment_total_cost_consumed(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
  UPDATE users SET total_cost_consumed = total_cost_consumed + p_amount WHERE id = p_user_id;
$$ LANGUAGE sql;

-- Add permission
-- IMPORTANT: Run these two statements separately (in separate SQL editor executions).
-- PostgreSQL requires enum values to be committed before use.

-- Step 1: Run this first, then click Run again for Step 2.
ALTER TYPE permission ADD VALUE IF NOT EXISTS 'can_manage_prices';

-- Step 2: Run this in a separate execution after Step 1 completes.
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'can_manage_prices' FROM roles WHERE name = 'admin'
ON CONFLICT DO NOTHING;

-- Drinks table (makes drink types data-driven)
CREATE TABLE drinks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL DEFAULT '🍵',
  is_popular BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed existing hardcoded drinks
INSERT INTO drinks (name, emoji, is_popular) VALUES
  ('Tea', '🍵', true),
  ('Coffee', '☕', true),
  ('Black Coffee', '☕', false),
  ('Black Tea', '🍵', false),
  ('Lemon Tea', '🍋', false),
  ('Plain Milk', '🥛', false),
  ('Badam Milk', '🥛', false);

-- Add permission for adding drinks
-- IMPORTANT: Run these two statements separately (in separate SQL editor executions).

-- Step 1: Run this first.
ALTER TYPE permission ADD VALUE IF NOT EXISTS 'can_add_drink';

-- Step 2: Run this in a separate execution after Step 1 completes.
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'can_add_drink' FROM roles WHERE name = 'admin'
ON CONFLICT DO NOTHING;

-- Add user_name and role_name columns to user_roles
ALTER TABLE user_roles ADD COLUMN user_name TEXT;
ALTER TABLE user_roles ADD COLUMN role_name TEXT;

-- Backfill from joined tables
UPDATE user_roles ur
SET
  user_name = u.name,
  role_name = r.name
FROM users u, roles r
WHERE ur.user_id = u.id
  AND ur.role_id = r.id;
