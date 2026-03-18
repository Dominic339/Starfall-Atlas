-- ============================================================
-- Migration 00013: Row-Level Security policies
-- Philosophy (alpha posture):
--   - All authenticated users may SELECT any row in public tables.
--   - Authenticated users may SELECT their own private rows.
--   - No authenticated user may INSERT/UPDATE/DELETE game state
--     directly. All writes go through the Next.js service-role
--     API layer (service role bypasses RLS).
--   - anon role has NO access to any game tables.
-- ============================================================

-- Enable RLS on every game table
ALTER TABLE players              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ships                ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_discoveries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_results       ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_ownership     ENABLE ROW LEVEL SECURITY;
ALTER TABLE colonies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE structures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE construction_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyperspace_lanes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lane_construction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_inventory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_listings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_trades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_tickets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids         ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliances            ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliance_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliance_goals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE alliance_goal_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_events         ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: resolve the player.id for the current auth user.
-- Used in policies to avoid repeated subqueries.
-- ============================================================
CREATE OR REPLACE FUNCTION auth_player_id()
RETURNS UUID AS $$
  SELECT id FROM players WHERE auth_id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- PUBLIC READ tables (any authenticated user can read)
-- These contain world-state data that all players should see.
-- ============================================================

-- Discoveries: public (anyone can see what's been found)
CREATE POLICY "authenticated_read_discoveries"
  ON system_discoveries FOR SELECT
  TO authenticated
  USING (TRUE);

-- Survey results: public once revealed
CREATE POLICY "authenticated_read_survey_results"
  ON survey_results FOR SELECT
  TO authenticated
  USING (TRUE);

-- System ownership: public
CREATE POLICY "authenticated_read_system_ownership"
  ON system_ownership FOR SELECT
  TO authenticated
  USING (TRUE);

-- Colonies: public
CREATE POLICY "authenticated_read_colonies"
  ON colonies FOR SELECT
  TO authenticated
  USING (TRUE);

-- Structures: public (which structures exist is visible; not details)
CREATE POLICY "authenticated_read_structures"
  ON structures FOR SELECT
  TO authenticated
  USING (TRUE);

-- Active hyperspace lanes: public
CREATE POLICY "authenticated_read_lanes"
  ON hyperspace_lanes FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

-- Open market listings: public
CREATE POLICY "authenticated_read_open_listings"
  ON market_listings FOR SELECT
  TO authenticated
  USING (status = 'open');

-- Own listings regardless of status
CREATE POLICY "own_all_listings"
  ON market_listings FOR SELECT
  TO authenticated
  USING (
    seller_id = auth_player_id() OR
    buyer_id  = auth_player_id()
  );

-- Market trades: public log
CREATE POLICY "authenticated_read_trades"
  ON market_trades FOR SELECT
  TO authenticated
  USING (TRUE);

-- Active auctions: public
CREATE POLICY "authenticated_read_active_auctions"
  ON auctions FOR SELECT
  TO authenticated
  USING (status = 'active');

-- Alliance info: public
CREATE POLICY "authenticated_read_alliances"
  ON alliances FOR SELECT
  TO authenticated
  USING (TRUE);

-- Alliance members: public roster
CREATE POLICY "authenticated_read_alliance_members"
  ON alliance_members FOR SELECT
  TO authenticated
  USING (TRUE);

-- Alliance goals: public
CREATE POLICY "authenticated_read_alliance_goals"
  ON alliance_goals FOR SELECT
  TO authenticated
  USING (TRUE);

-- World events log: public feed
CREATE POLICY "authenticated_read_world_events"
  ON world_events FOR SELECT
  TO authenticated
  USING (TRUE);

-- ============================================================
-- PRIVATE READ tables (owner-only)
-- ============================================================

-- Players: own row only for private fields
-- (A separate public profile view can be added later)
CREATE POLICY "own_player_row"
  ON players FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

-- Ships: owner only
CREATE POLICY "own_ships"
  ON ships FOR SELECT
  TO authenticated
  USING (owner_id = auth_player_id());

-- Survey jobs: owner only
CREATE POLICY "own_survey_jobs"
  ON survey_jobs FOR SELECT
  TO authenticated
  USING (player_id = auth_player_id());

-- Construction jobs: owner only
CREATE POLICY "own_construction_jobs"
  ON construction_jobs FOR SELECT
  TO authenticated
  USING (player_id = auth_player_id());

-- Lane construction jobs: owner only
CREATE POLICY "own_lane_construction_jobs"
  ON lane_construction_jobs FOR SELECT
  TO authenticated
  USING (player_id = auth_player_id());

-- Travel jobs: owner only
CREATE POLICY "own_travel_jobs"
  ON travel_jobs FOR SELECT
  TO authenticated
  USING (player_id = auth_player_id());

-- Resource inventory: owner of location only
-- Colony inventory: colony owner
-- Ship inventory: ship owner
-- Alliance storage: alliance members
CREATE POLICY "own_resource_inventory"
  ON resource_inventory FOR SELECT
  TO authenticated
  USING (
    (location_type = 'colony' AND EXISTS (
      SELECT 1 FROM colonies
      WHERE id = location_id AND owner_id = auth_player_id()
    )) OR
    (location_type = 'ship' AND EXISTS (
      SELECT 1 FROM ships
      WHERE id = location_id AND owner_id = auth_player_id()
    )) OR
    (location_type = 'alliance_storage' AND EXISTS (
      SELECT 1 FROM alliance_members
      WHERE alliance_id = location_id AND player_id = auth_player_id()
    ))
  );

-- Claim tickets: buyer only
CREATE POLICY "own_claim_tickets"
  ON claim_tickets FOR SELECT
  TO authenticated
  USING (buyer_id = auth_player_id());

-- Auction bids: own bids only (high bid is visible via auction row)
CREATE POLICY "own_auction_bids"
  ON auction_bids FOR SELECT
  TO authenticated
  USING (bidder_id = auth_player_id());

-- Alliance goal contributions: own or same alliance
CREATE POLICY "own_goal_contributions"
  ON alliance_goal_contributions FOR SELECT
  TO authenticated
  USING (player_id = auth_player_id());

-- Premium entitlements: owner only
CREATE POLICY "own_premium_entitlements"
  ON premium_entitlements FOR SELECT
  TO authenticated
  USING (player_id = auth_player_id());

-- ============================================================
-- NO DIRECT WRITES from authenticated role.
-- All INSERT/UPDATE/DELETE is handled by the service-role
-- client in Next.js API routes. The service role bypasses RLS.
-- These explicit DENY policies document intent clearly.
-- (Absence of a policy also denies, but explicit is clearer.)
-- ============================================================
-- NOTE: By default with RLS enabled, if no matching policy exists
-- for an operation, access is denied. Since we only defined SELECT
-- policies above, all INSERT/UPDATE/DELETE from the authenticated
-- role are already denied. No additional policies needed.
