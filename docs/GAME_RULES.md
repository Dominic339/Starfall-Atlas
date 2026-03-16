# Starfall Atlas — Game Rules

> Version: 0.1 (Alpha Design)
> Last updated: 2026-03-16

This document defines the authoritative game rules for Starfall Atlas. All server logic must conform to these rules. UI, API routes, and database constraints must be derived from and consistent with this document.

---

## Table of Contents

1. [World Overview](#1-world-overview)
2. [Discovery](#2-discovery)
3. [Surveying](#3-surveying)
4. [Claims and Ownership](#4-claims-and-ownership)
5. [Colony Growth](#5-colony-growth)
6. [Resources](#6-resources)
7. [Taxes and Currency Injection](#7-taxes-and-currency-injection)
8. [Travel and Hyperspace Lanes](#8-travel-and-hyperspace-lanes)
9. [Markets and Trading](#9-markets-and-trading)
10. [Auctions](#10-auctions)
11. [Alliances](#11-alliances)
12. [Alliance Credits and Internal Trade](#12-alliance-credits-and-internal-trade)
13. [Royalties](#13-royalties)
14. [Premium Items](#14-premium-items)
15. [Anti-Pay-to-Win Guardrails](#15-anti-pay-to-win-guardrails)
16. [Multiplayer Visibility](#16-multiplayer-visibility)
17. [Contested Claims and Resolution](#17-contested-claims-and-resolution)
18. [Pre-Colony Travel](#18-pre-colony-travel)

---

## 1. World Overview

- The galaxy is built from a **real star catalog** (e.g., HYG Database). Star positions, spectral types, and distances are deterministic and seeded — they never change.
- Each star system can contain one or more bodies (planets, moons, asteroid belts, gas giants) generated deterministically from the star's seed.
- System bodies and their base resource profiles are derived from the seed. Only **player actions** (claims, structures, depletion, market listings) are stored in the database.
- All players share one persistent galaxy. There are no shards or private instances.
- The game starts at **Sol** (Earth's solar system). All players begin there and expand outward.

---

## 2. Discovery

- A star system must be **discovered** before any player can interact with it.
- Discovery requires a player to have a ship at Sol or any system with a hyperspace lane that reaches the target system, and submit a discovery action.
- Discovery is **not exclusive**: multiple players can discover the same system. The first discoverer is recorded and may receive a cosmetic "first discoverer" badge on the system, but no gameplay advantage.
- Undiscovered systems within range are visible on the map as faint points of light but show no detail until discovered.
- Discovery is **free** (no currency cost), but requires travel time.
- Discovery actions are **timestamp-based**: the player's ship departs at a recorded server timestamp and arrives after a calculated duration based on distance and ship speed.

---

## 3. Surveying

- After a system is discovered, individual bodies (planets, asteroid belts, moons) must be **surveyed** to reveal their resource profiles.
- Surveying is a queued action. A player assigns a ship to a body; the server records `survey_start_at` and `survey_complete_at`.
- Survey data is deterministic once revealed: the same body always has the same resources. Survey results are stored in the database and shared with all players who have surveyed the body.
- Surveying does **not** grant exclusive access. Any player can survey any body in a discovered system.
- A **deep survey** (premium item) reveals rare or hidden resource nodes not found in a basic survey.

---

## 4. Claims and Ownership

### 4.1 Claiming a Colony Site

- A player may **claim** a habitable planet or suitable body as a colony site.
- Claiming requires:
  1. The target body has been surveyed by the claiming player.
  2. The player's ship is physically present (travel complete, timestamp resolved).
  3. The body is unclaimed.
- The first player to complete the deployment action (server-side timestamp of action completion) wins the claim. See [Section 17](#17-contested-claims-and-resolution) for contention rules.
- A player's **first colony is free**. Additional colonies may require an in-game resource cost (defined per phase).
- A player may not hold more colonies than their current colony limit (starts at 1 free; expansions earned through gameplay milestones or premium items).

### 4.2 Claiming an Entire System

- A player "owns a system" when they have a colony on the star's primary habitable body, or when they have claimed the system's anchor point (a specific body per system defined by seed).
- System ownership grants the right to:
  - Build and tax hyperspace lanes connecting to that system.
  - Set mining royalties for the system.
  - List the system for sale or auction.

### 4.3 Releasing a Claim

- Players may voluntarily release a claim, returning the body to unclaimed status.
- All structures on the body are abandoned and degraded; resources stored on-site remain for a limited window and then disappear.

---

## 5. Colony Growth

- Colonies have a **population level** (integer tier, starts at 1).
- Population grows over time (timestamp-based: server calculates next growth event when colony is updated).
- Growth rate depends on: available food resources, colony infrastructure tier, and whether supply lanes are active.
- Each population tier unlocks higher resource extraction rates and new structure types.
- Colonies produce a **tax income** automatically on a defined tick cycle (see Section 7).
- Players can build structures on colony planets:
  - **Extractor**: mines a specific resource from the body.
  - **Warehouse**: increases on-planet storage.
  - **Shipyard**: allows construction of ships (post-alpha).
  - **Trade Hub**: connects the colony to the regional market.
  - **Relay Station**: extends hyperspace lane reach.
- Structures are built via queued jobs (construction start and complete timestamps stored server-side).

---

## 6. Resources

- Resources are tied to specific bodies and extracted by Extractors.
- Resource categories (full list defined in seed schema):
  - **Common**: Iron, Carbon, Ice
  - **Refined**: Steel, Fuel Cells, Polymers (crafted from common resources)
  - **Rare**: Exotic Matter, Crystalline Core, Void Dust
- Resources exist as **item quantities** in a location's inventory (colony storage or ship cargo).
- Resources can be transported via ships along hyperspace lanes.
- Resources are consumed by: structure construction, colony supply, alliance ship storage, ship construction (post-alpha).
- Resource quantities are integers. No fractional amounts.
- Resources have no inherent currency value — value is entirely determined by the player-driven market.

---

## 7. Taxes and Currency Injection

- **Credits** (in-game currency) are injected **only** via colony tax generation. No other source creates new credits.
- Each colony generates tax yield based on its population tier:

| Tier | Credits/hour |
|------|-------------|
| 1    | 10          |
| 2    | 25          |
| 3    | 60          |
| 4+   | Defined in later phases |

- Tax is calculated server-side at the tick cycle. The server reads `last_tax_collected_at` and calculates accumulated yield since that timestamp.
- Players collect taxes manually (or on a configured schedule). Uncollected taxes accumulate up to a **cap** of 24 hours of yield, preventing runaway idle accumulation.
- **No other source generates Credits**: exploration, surveying, and construction produce no direct currency. All currency ultimately comes from colony taxes.

---

## 8. Travel and Hyperspace Lanes

### 8.1 Travel Mechanics

- All travel is **timestamp-based**. Ships do not move in real time:
  1. Player submits a travel action.
  2. Server validates the route and records `depart_at` (server timestamp) and `arrive_at` (depart_at + travel_duration).
  3. At any point after `arrive_at`, the player may resolve the arrival to trigger further actions.
- Travel duration is calculated from: distance (light-years), ship speed (ly/hr), and lane bonuses.
- A ship in transit cannot take other actions.

### 8.2 Hyperspace Lanes

- A hyperspace lane is a permanent directed connection between two systems.
- **Building a lane** requires:
  1. The builder owns (has a colony in) at least one of the two endpoint systems.
  2. The builder spends the required resource and credit cost.
  3. A construction job completes (timestamp-based).
- The lane owner is the player who constructed it.
- Lane access levels:
  - **Public**: any player may travel it (owner may set a transit tax ≤ cap).
  - **Alliance-only**: only alliance members may travel it (owner may set a transit tax).
  - **Private**: only the owner may travel it.
- Lane transit taxes are paid to the lane owner in Credits, deducted at arrival resolution.
- **Transit tax cap**: 5% of the ship's declared cargo value, or a flat maximum defined by server config. Owners set a rate at or below the cap.
- Lanes are persistent but can be demolished by the owner at a resource cost.

### 8.3 Pre-Colony Free Travel

- Before a player has established their first colony, their ship may use **any public hyperspace lane for free** (transit tax waived).
- This ensures new players can explore freely and are never trapped without a path home.
- Once the player places their first colony, normal lane tax rules apply.

### 8.4 Lane Range and Relay Stations

- Base lane range: **10 light-years**.
- A Relay Station at either endpoint extends range by 5 ly per station tier.
- Lanes cannot span further than the combined range allows.

---

## 9. Markets and Trading

### 9.1 Regional Markets

- The galaxy is divided into **regions** (seed-defined clusters of stars).
- Each region has one market instance. Players with a Trade Hub in the region may access it.
- Markets are **player-driven**: only player-created listings exist. No NPC buy/sell orders.
- **Sell listing**: resource type, quantity, price per unit, expiry timestamp.
- **Buy order**: resource type, quantity, max price per unit, expiry timestamp.
- When a sell price ≤ a buy order price, the server matches them automatically at the sell price.
- Credits transfer from buyer to seller at match time, atomically.
- Unmatched listings expire. Resources/credits are held in escrow while the listing is active.

### 9.2 Market Fees

- A **2% listing fee** is charged at listing creation, deducted from the listing credit value.
- Listing fees are burned (removed from supply) to act as a mild deflationary sink.

### 9.3 Resource Transport

- Buying on a market does not teleport goods. The buyer receives a **claim ticket** and must send a ship to the listing system to pick up the resources.
- Fulfilled shipping orders (seller ships goods) are a post-alpha feature.

---

## 10. Auctions

- Players may auction off:
  - Unclaimed or claimed colony sites (with or without structures).
  - Entire system ownership rights.
  - Ships (post-alpha).
  - Rare items.
- Auctions have a **start time**, **end time**, and **minimum bid**.
- Bids are held in escrow. When a new high bid is placed, the previous high bidder's escrow is released immediately.
- At end time, the server resolves: ownership transfers to highest bidder, funds transfer to seller, atomically.
- **Anti-snipe rule**: any bid placed within the last 5 minutes extends the auction timer by 5 minutes.
- Auctions for owned systems must be confirmed by the seller. Colonists (if different from system owner) are notified but cannot block the sale.

---

## 11. Alliances

- Players may form or join a **Trade Alliance**.
- **Maximum members**: 100.
- Membership tiers:
  - **Founder**: full permissions; can dissolve the alliance.
  - **Officer**: can invite/kick members, manage alliance ship storage, post goals.
  - **Member**: can donate resources, use alliance ship, vote on goals.
- A player may belong to **one alliance at a time**.
- Alliance dissolution: Founder-only. Alliance credits refunded pro-rata to members; alliance ship storage contents returned to Founder.

### 11.1 Alliance Goals

- Officers post **Alliance Goals**: an objective with a resource target and deadline.
- When completed (resource target met), the alliance receives a bonus payout in Alliance Credits.
- Incomplete goals expire without penalty.

### 11.2 Alliance Diplomacy (Alpha Scope)

- In alpha, alliance interaction is limited to: market listings, lane access permissions, and in-game messaging.
- No formal war/peace treaty system in alpha.

---

## 12. Alliance Credits and Internal Trade

### 12.1 Alliance Credits

- **Alliance Credits** are an internal per-alliance currency.
- Earned by:
  - Donating resources to alliance storage (exchange rate set by Officers).
  - Completing Alliance Goals.
  - Officer discretionary grants.
- Alliance Credits **cannot be converted** to regular Credits and are non-transferable between players.
- Spent on: Alliance Ship withdrawals, alliance cosmetic upgrades (post-alpha).

### 12.2 Alliance Ship Storage

- Each alliance has a shared **Alliance Ship Storage** (virtual stockpile).
- Members with sufficient Alliance Credits may withdraw resources instantly, paying Alliance Credits.
- Withdrawal exchange rate is set by Officers. Officers may restrict withdrawal of specific resource types.

---

## 13. Royalties

- A system owner may set a **mining royalty rate** (0–20%) on all resource extraction within their system.
- When an Extractor owned by a non-owner produces resources in that system, the royalty percentage is deducted and credited to the system owner in Credits.
- Royalty rates are set per-system and apply to all bodies in the system.
- Royalty changes take effect on the next extraction tick.
- If a player owns both the system and the extractor, no royalty is deducted.

---

## 14. Premium Items

Premium items are purchased with real money via the **Premium Shop**. Two categories: cosmetics and single-use mobility/utility items.

### 14.1 Cosmetics (no gameplay effect)

- Ship skins
- Colony flag/banner customization
- Star/system vanity name tags (displayed alongside the canonical name)
- Alliance emblems
- Discoverer monument (decorative marker placed on first-discovered systems)

### 14.2 Single-Use Mobility and Utility Items

| Item | Effect |
|------|--------|
| **Unstable Warp Tunnel** | Creates a temporary one-way lane to any discovered system, ignoring range limits. Single use. Does not bypass lane taxes. |
| **Stabilized Wormhole** | Creates a persistent two-way lane between two player-owned systems. Counts against lane cap. Cheaper than constructing a normal lane. |
| **Deep Survey Kit** | Reveals rare/hidden resource nodes on a body that basic survey does not find. |
| **Colony Permit** | Grants +1 colony slot. Limited to 2 permits per account lifetime. |

### 14.3 Restrictions

- Premium items are **account-bound**: cannot be sold, traded, or auctioned.
- All items are consumed server-side and tracked in `premium_entitlements`.

---

## 15. Anti-Pay-to-Win Guardrails

1. **No currency sales**: Credits cannot be purchased with real money, directly or indirectly.
2. **No resource sales**: Resources cannot be purchased with real money.
3. **Colony slots are soft-capped**: Colony Permit adds only +1 slot and is capped at 2 permits per account. Free players earn additional slots via gameplay milestones.
4. **Warp Tunnels do not bypass taxes**: Mobility items move players faster but grant no economic exemptions.
5. **Deep Surveys do not inflate totals**: The same resource cap applies whether a node was found by basic or deep survey. The item only changes discovery speed.
6. **No speed-to-claim conversion**: Arriving faster does not override an already-completed deployment action.
7. **Server authority is unchanged**: Premium items do not short-circuit server resolution of claims, auctions, or lane construction.

---

## 16. Multiplayer Visibility

Because the game has no live real-time simulation, multiplayer presence is conveyed through:

- **Activity indicators**: "Last active X hours ago" per colony/system, visible to all visitors.
- **Shared lane network**: The hyperspace lane map is visible to all players and shows ownership.
- **Market listings**: All regional market listings are publicly visible.
- **Alliance roster**: Public alliance membership list and in-progress goals.
- **Auction boards**: All active auctions are visible galaxy-wide.
- **Discovery log**: Global feed of recent first-discoveries (system name, discoverer handle, timestamp).
- **World changes feed**: Scrollable log of major events: new colonies, system sales, large trades, alliance formations.
- **No live ship rendering**: Ships are not rendered as moving objects. A ship's presence at a location is shown only after arrival is resolved.

---

## 17. Contested Claims and Resolution

- Claims and lane placements are the primary competitive actions in the game.
- **Resolution rule**: The action whose `complete_at` timestamp (arrival time + deployment duration) is **earliest** wins.
- If two players share the same `complete_at` timestamp (within 1 second), the server uses insertion order (lower primary-key ID wins).
- Losers of a contested claim are notified, and their deployment action is fully refunded.
- There is **no claim queue** — only first completion wins.
- This rule applies to: colony claims, system anchor claims, and lane construction at shared endpoints.

---

## 18. Pre-Colony Travel

- Before placing their first colony, a player's ship may traverse **any public lane for free** (transit tax = 0).
- The player still must travel via lanes (cannot teleport to unreachable systems).
- The free-travel window ends the moment the player's first colony claim is finalized server-side.
- This prevents new players from being economically blocked from exploring or reaching their desired colony site.
