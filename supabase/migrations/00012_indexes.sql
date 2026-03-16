-- ============================================================
-- Migration 00012: Performance indexes
-- Covers the most common access patterns for the alpha game loop.
-- ============================================================

-- Players
CREATE INDEX idx_players_auth_id      ON players (auth_id);
CREATE INDEX idx_players_handle       ON players (handle);

-- Ships
CREATE INDEX idx_ships_owner          ON ships (owner_id);
CREATE INDEX idx_ships_location       ON ships (current_system_id)
  WHERE current_system_id IS NOT NULL;

-- World
CREATE INDEX idx_discoveries_system   ON system_discoveries (system_id);
CREATE INDEX idx_discoveries_player   ON system_discoveries (player_id);
CREATE INDEX idx_survey_jobs_player   ON survey_jobs (player_id);
CREATE INDEX idx_survey_jobs_body     ON survey_jobs (body_id);
CREATE INDEX idx_survey_results_body  ON survey_results (body_id);
CREATE INDEX idx_survey_results_sys   ON survey_results (system_id);

-- Colonies & structures
CREATE INDEX idx_colonies_owner       ON colonies (owner_id);
CREATE INDEX idx_colonies_system      ON colonies (system_id);
CREATE INDEX idx_system_ownership_sys ON system_ownership (system_id);
CREATE INDEX idx_structures_colony    ON structures (colony_id);
CREATE INDEX idx_constr_jobs_struct   ON construction_jobs (structure_id);
CREATE INDEX idx_constr_jobs_player   ON construction_jobs (player_id);
CREATE INDEX idx_constr_jobs_status   ON construction_jobs (status)
  WHERE status = 'pending';

-- Lanes
CREATE INDEX idx_lanes_owner          ON hyperspace_lanes (owner_id);
CREATE INDEX idx_lanes_from           ON hyperspace_lanes (from_system_id);
CREATE INDEX idx_lanes_to             ON hyperspace_lanes (to_system_id);
CREATE INDEX idx_lane_constr_lane     ON lane_construction_jobs (lane_id);

-- Travel
CREATE INDEX idx_travel_ship          ON travel_jobs (ship_id);
CREATE INDEX idx_travel_player        ON travel_jobs (player_id);
CREATE INDEX idx_travel_status        ON travel_jobs (status)
  WHERE status = 'pending';

-- Resources
CREATE INDEX idx_inventory_location   ON resource_inventory (location_type, location_id);
CREATE INDEX idx_inventory_type       ON resource_inventory (resource_type);

-- Economy
CREATE INDEX idx_listings_region      ON market_listings (region_id, status)
  WHERE status = 'open';
CREATE INDEX idx_listings_seller      ON market_listings (seller_id);
CREATE INDEX idx_listings_buyer       ON market_listings (buyer_id);
CREATE INDEX idx_listings_resource    ON market_listings (resource_type, region_id)
  WHERE status = 'open';
CREATE INDEX idx_trades_sell          ON market_trades (sell_listing_id);
CREATE INDEX idx_trades_buy           ON market_trades (buy_listing_id);
CREATE INDEX idx_claim_tickets_buyer  ON claim_tickets (buyer_id)
  WHERE claimed = FALSE;
CREATE INDEX idx_auctions_status      ON auctions (status, ends_at)
  WHERE status = 'active';
CREATE INDEX idx_auction_bids_auction ON auction_bids (auction_id);
CREATE INDEX idx_auction_bids_bidder  ON auction_bids (bidder_id);

-- Alliances
CREATE INDEX idx_alliance_members_alliance ON alliance_members (alliance_id);
CREATE INDEX idx_alliance_goals_alliance   ON alliance_goals (alliance_id)
  WHERE completed_at IS NULL AND expired = FALSE;
CREATE INDEX idx_contributions_goal        ON alliance_goal_contributions (goal_id);
CREATE INDEX idx_contributions_player      ON alliance_goal_contributions (player_id);

-- Premium
CREATE INDEX idx_premium_player       ON premium_entitlements (player_id, item_type)
  WHERE consumed = FALSE;

-- Logs
CREATE INDEX idx_world_events_type    ON world_events (event_type, occurred_at DESC);
CREATE INDEX idx_world_events_system  ON world_events (system_id)
  WHERE system_id IS NOT NULL;
CREATE INDEX idx_world_events_player  ON world_events (player_id)
  WHERE player_id IS NOT NULL;
