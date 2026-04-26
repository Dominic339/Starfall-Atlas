-- Add last_resolved_at to live_event_nodes so harvest resolution can track
-- progress the same way it does for asteroid_nodes.
-- Defaults to spawned_at so existing rows are treated as never-resolved.

ALTER TABLE live_event_nodes
  ADD COLUMN IF NOT EXISTS last_resolved_at TIMESTAMPTZ;

UPDATE live_event_nodes
  SET last_resolved_at = spawned_at
  WHERE last_resolved_at IS NULL;

ALTER TABLE live_event_nodes
  ALTER COLUMN last_resolved_at SET NOT NULL,
  ALTER COLUMN last_resolved_at SET DEFAULT now();
