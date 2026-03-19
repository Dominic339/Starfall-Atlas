# Starfall Atlas — Game Rules

> Version: 0.3 (Alignment update — core station model, Sol protection)
> Last updated: 2026-03-18

This document defines the authoritative game rules for Starfall Atlas. All server logic must conform to these rules. UI, API routes, and database constraints must be derived from and consistent with this document.

---

## Table of Contents

1. [World Overview](#1-world-overview)
2. [Discovery](#2-discovery)
3. [Surveying](#3-surveying)
4. [Claims, Stewardship, and Control](#4-claims-stewardship-and-control)
5. [Colony Growth and Influence](#5-colony-growth-and-influence)
6. [Resources](#6-resources)
7. [Economy: Credits vs Resources](#7-economy-credits-vs-resources)
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
19. [Emergency Universal Exchange](#19-emergency-universal-exchange)
20. [Inactivity and Colony Collapse](#20-inactivity-and-colony-collapse)
21. [Player Core Station](#21-player-core-station)
22. [Sol Safety Stipend](#22-sol-safety-stipend)

---

## 1. World Overview

- The galaxy is built from a **real star catalog** (e.g., HYG Database). Star positions, spectral types, and distances are deterministic and seeded — they never change.
- Each star system can contain one or more bodies (planets, moons, asteroid belts, gas giants) generated deterministically from the star's seed.
- System bodies and their base resource profiles are derived from the seed. Only **player actions** (claims, structures, depletion, market listings) are stored in the database.
- All players share one persistent galaxy. There are no shards or private instances.
- The game starts at **Sol** (Earth's solar system). All players begin there and expand outward.

### 1.1 Sol — Protected Shared Starter System

Sol is special and subject to rules that differ from all other systems:

- **Sol cannot be colonized.** No body in Sol may be claimed or settled by any player.
- **Sol has no steward.** It is not discoverable and does not participate in the stewardship or majority-control governance systems.
- **Sol is always known.** Players do not need to travel to Sol or perform a discovery action — it is the universal starting point.
- **Sol does not generate influence.** Since colonies cannot exist in Sol, it contributes no system influence to any player.
- **Sol bodies can be surveyed.** Survey data is available to understand what Sol contains, but survey results grant no special rights to colonize.
- These rules are permanent design invariants, enforced server-side. They cannot be bypassed by stewardship, majority control, or any premium item.

### 1.2 Starter Assets

Every newly registered player begins with:

- **Two starter ships** placed at Sol, immediately available for exploration and resource transport.
- **One core player station** anchored at Sol (see §21).

Ships are the active layer of the player economy: exploration, resource collection, and transport. The core station is the player's permanent hub.

---

## 2. Discovery

- A star system must be **discovered** before any player can interact with it.
- Discovery requires a player to have a ship at Sol or any system with a hyperspace lane that reaches the target system, and submit a discovery action.
- Discovery is **not exclusive**: multiple players can discover the same system. The first discoverer is recorded permanently.
- **First discoverer stewardship**: the very first player to register a discovery of a system automatically becomes its **steward** (see §4.2). No additional action is required.
- Undiscovered systems within range are visible on the map as faint points of light but show no detail until discovered.
- Discovery is **free** (no currency or resource cost), but requires travel time.
- Discovery actions are **timestamp-based**: the player's ship departs at a recorded server timestamp and arrives after a calculated duration based on distance and ship speed.

---

## 3. Surveying

- After a system is discovered, individual bodies (planets, asteroid belts, moons) must be **surveyed** to reveal their resource profiles.
- Surveying is a queued action. A player assigns a ship to a body; the server records `survey_start_at` and `survey_complete_at`.
- Survey data is deterministic once revealed: the same body always has the same resources. Survey results are stored in the database and shared with all players who have surveyed the body.
- Surveying does **not** grant exclusive access. Any player can survey any body in a discovered system.
- A **deep survey** (premium item) reveals rare or hidden resource nodes not found in a basic survey.

---

## 4. Claims, Stewardship, and Control

This section covers all five distinct layers of system control. They must not be conflated:

| Concept | Holder | What it represents |
|---------|--------|--------------------|
| **Discovery credit** | First discoverer (permanent) | Cosmetic recognition; never changes |
| **Stewardship** | Initially the first discoverer; transferable | Early administrative and governance rights |
| **Colony ownership** | Individual player | Ownership of a specific settled body |
| **Majority control** | Player or alliance with >50% system influence | Long-term system governance; supersedes steward governance |
| **Infrastructure control** | Governance holder (steward or majority controller) | Gate construction/operation and lane policy |

### 4.1 Claiming a Colony Site

- A player may **claim** a habitable planet or suitable body as a colony site.
- **Sol bodies can never be claimed.** Sol is a protected starter system and is not subject to colonization by any player under any circumstances (see §1.1).
- Claiming requires:
  1. The target body has been surveyed (by any player — survey results are public).
  2. The player's ship is physically present (travel complete, timestamp resolved).
  3. The body is unclaimed (not currently occupied by an active or abandoned colony).
- The first player to complete the deployment action (server-side `complete_at` timestamp) wins the claim.
  See [Section 17](#17-contested-claims-and-resolution) for contention rules.
- A player's **first colony is free**. Additional colonies may require an in-game resource cost (defined per phase).
- A player may not hold more colonies than their current colony limit (starts at 1; expansions earned via gameplay milestones or Colony Permit premium items).
- Any player may claim any unclaimed body within any discovered system, regardless of who holds stewardship or governance over that system. Stewardship does **not** grant exclusive claim rights.
- Players settling in a system they do not govern will owe royalties to the governance holder (see §13).

### 4.2 System Stewardship

- The **first player to discover a system** is automatically registered as its **steward**.
- Stewardship is recorded as a permanent discovery credit (cosmetic) and a governance status (functional). These are distinct:
  - **Discovery credit** is permanent and cannot be transferred.
  - **Governance status** can shift to the majority controller if one emerges (see §4.3).
- While the steward holds governance, they may:
  - Set the system royalty rate (0–20%) charged to non-governing extractors.
  - Initiate construction of the system's hyperspace gate (see §8.2).
  - Configure gate access policies (who may use the gate).
  - List system stewardship rights for auction (governance and future majority-control transfer, not the discovery credit).
- Stewardship governance **does not** grant:
  - The right to block other players from settling in the system.
  - Control over individual colony operations.
  - Immunity from losing governance to a majority controller.
- Stewardship can be transferred voluntarily or via auction. Discovery credit stays with the original discoverer regardless of any transfer.

### 4.3 System Influence and Majority Control

**Influence** measures a player's (or alliance's) development footprint within a system.

#### Influence formula

Each player's influence in a system is the sum of:

| Source | Influence |
|--------|-----------|
| Each active colony in the system | `10 × population_tier` |
| Each active non-extractor structure | `5` per structure |
| Each active extractor | `3` per extractor |
| Owning the system's hyperspace gate | `50` (one-time) |

- Abandoned or collapsed colonies contribute **zero** influence.
- Structures on abandoned/collapsed colonies contribute **zero** influence.

#### Majority control threshold

Majority control activates when **all** of the following are true:

1. The system has at least **3 bodies with active colonies** (development threshold).
2. A single player (or combined alliance) holds **more than 50%** of total system influence.

When both conditions are met:
- The player or alliance claiming majority is designated the **majority controller**.
- The majority controller gains all governance rights, superseding the steward's governance.
- The steward retains discovery credit (cosmetic) but loses governance.
- This event is logged in `world_events` as `majority_control_gained`.

#### Alliance majority control

- An alliance's combined influence from all members is treated as a single block for majority control purposes.
- The alliance founder or an officer must explicitly claim majority control once conditions are met (this is a submitted server action, not automatic).
- Alliance majority control is governed by the alliance founder/officers.

#### Loss of majority control

- If the majority controller's influence drops below 50% (due to colony collapse, abandonment, or other players growing), majority control is contested.
- Governance reverts to the steward if no new majority forms within a resolution window (defined in balance config).
- If the steward's colonies have also collapsed, governance is temporarily ungoverned.

### 4.4 Governance and Infrastructure Control

- The current **governance holder** (steward or majority controller, whichever currently has governance) controls:
  - Gate construction (see §8.2).
  - Gate access policy.
  - System royalty rates.
- When governance transfers (steward to majority controller, or to a new majority), **existing gate structures remain physically present** but their access policy resets to neutral:
  - A neutral gate can be traversed by all players (public access).
  - The new governance holder must explicitly reactivate and reconfigure the gate to restore policy control.
  - This is a design invariant: **infrastructure is never deleted by governance change**.
- The new governance holder may reclaim an existing gate by submitting a reclaim action (resource cost, no full reconstruction required).

### 4.5 Releasing a Colony Claim

- Players may voluntarily release a colony claim, returning the body to unclaimed status.
- All structures on the body are abandoned; resources stored on-site remain for a limited window and then disappear.
- Released colonies reduce the former owner's influence in the system.

---

## 5. Colony Growth and Influence

- Colonies have a **population level** (integer tier, starts at 1).
- Population grows over time (timestamp-based: server calculates next growth event when colony is updated).
- Growth rate depends on: available food resources, colony infrastructure tier, and whether supply lanes are active.
- Each population tier unlocks higher resource extraction rates and new structure types.
- **Influence contribution**: each active colony contributes `10 × population_tier` influence to its owner's system influence score. This influence is recalculated server-side when:
  - A colony tier changes.
  - A colony is abandoned or collapsed.
  - Structures are built or removed.
- Players can build structures on colony bodies. Structures are **resource-built** — they consume resources from the colony's inventory. No credit cost:
  - **Extractor**: mines a specific resource from the body.
  - **Warehouse**: increases on-body storage.
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
- Resources are consumed by: structure construction, colony supply, gate construction, lane construction, alliance ship storage, ship construction (post-alpha).
- Resource quantities are integers. No fractional amounts.
- Resources have no inherent credit value — value is entirely determined by the player-driven market.

---

## 7. Economy: Credits vs Resources

The economy has two distinct layers that must not be conflated:

### 7.1 Resources: the construction economy

- **All buildings, upgrades, colonies, gates, and infrastructure are resource-built.** Credits are not spent on construction.
- Resource costs are paid from the builder's colony inventory or ship cargo at job submission.
- The resource economy is driven by extraction (Extractors), crafting (refined resources), and trading.

**Resource logistics model**: Colonies produce resources via Extractors. Ships collect resources from colonies and transport them to other colonies, the player's core station, or market pickup points. The **core station** is the intended long-term hub of the player's resource economy — not a passive wallet, but an active node in the logistics network.

### 7.2 Credits: the market economy

- **Credits** are the in-game currency used in player-run markets and auctions.
- Credits are injected **only** via colony tax generation. No other source creates new credits.
- Credits are spent on: market listing fees (burned), transit lane taxes (to lane owners), auction bids.
- Each colony generates tax yield based on its population tier:

| Tier | Credits/hour |
|------|-------------|
| 1    | 10          |
| 2    | 25          |
| 3    | 60          |
| 4+   | Defined in later phases |

- Tax is calculated server-side lazily. The server reads `last_tax_collected_at` and calculates accumulated yield since that timestamp.
- Players collect taxes manually. Uncollected taxes accumulate up to a **cap** of 24 hours of yield, preventing runaway idle accumulation.
- **No other source generates Credits**: exploration, surveying, and construction produce no direct currency.

### 7.3 Credit sinks

- Market listing fee: 2% of listing value (burned).
- Transit taxes: paid to lane owners.
- Emergency Universal Exchange (see §19): credits burned to purchase basic resources from NPC reserve.

---

## 8. Travel and Hyperspace Lanes

### 8.1 Travel Mechanics

- All travel is **timestamp-based**. Ships do not move in real time:
  1. Player submits a travel action.
  2. Server validates the route and records `depart_at` (server timestamp) and `arrive_at` (depart_at + travel_duration).
  3. At any point after `arrive_at`, the player may resolve the arrival to trigger further actions.
- Travel duration is calculated from: distance (light-years), ship speed (ly/hr), and lane bonuses.
- A ship in transit cannot take other actions.

### 8.2 Hyperspace Gates and Lanes

#### Gates

- A **hyperspace gate** is a system-level infrastructure structure. There is at most **one gate per system**.
- Gates are not attached to any specific body — they operate at the system level.
- Only the current **governance holder** of a system may initiate gate construction.
- Gate construction requires a resource cost and a construction job (timestamp-based). No credit cost.
- A gate can be in one of three states:
  - **inactive**: under construction.
  - **active**: operational; the governance holder controls access policy.
  - **neutral**: governance changed; no owner managing policy; all players may traverse it (public access).
- When governance transfers to a new player or alliance, the gate becomes **neutral**. It is not demolished. The new governance holder may reclaim it at reduced cost.

#### Lanes

- A **hyperspace lane** is a permanent directed connection between two systems, routed through their gates.
- **Building a lane requires**:
  1. An active or neutral gate exists at both endpoint systems.
  2. The builder holds governance at at least one of the two endpoint systems.
  3. The builder provides the required resource cost.
  4. A construction job completes (timestamp-based).
- The lane owner is the player who constructed it. Lane ownership is separate from gate governance.
- Lane access levels:
  - **Public**: any player may travel it (owner may set a transit tax ≤ cap).
  - **Alliance-only**: only alliance members may travel it.
  - **Private**: only the owner may travel it.
- Lane transit taxes are paid to the lane owner in Credits, deducted at arrival resolution.
- **Transit tax cap**: 5% of the ship's declared cargo value. Owners set a rate at or below the cap.
- Lanes are persistent but can be demolished by the owner at a resource cost.
- If a gate becomes neutral, lanes through it remain active unless the governance holder of the opposite endpoint revokes them.

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
- Markets are **player-driven**: only player-created listings exist. No NPC buy/sell orders. (The Emergency Universal Exchange in §19 is a separate, limited backstop.)
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
  - Individual colony sites (with or without structures).
  - **System stewardship rights** (governance rights only — discovery credit stays with original discoverer).
  - Ships (post-alpha).
  - Rare items.
- Auctions have a **start time**, **end time**, and **minimum bid** (Credits).
- Bids are held in escrow. When a new high bid is placed, the previous high bidder's escrow is released immediately.
- At end time, the server resolves: ownership/rights transfer to highest bidder, funds transfer to seller, atomically.
- **Anti-snipe rule**: any bid placed within the last 5 minutes extends the auction timer by 5 minutes.
- Auctioning stewardship notifies all colony owners in the system but does not require their consent.

---

## 11. Alliances

- Players may form or join a **Trade Alliance**.
- **Maximum members**: 100.
- Membership tiers:
  - **Founder**: full permissions; can dissolve the alliance.
  - **Officer**: can invite/kick members, manage alliance ship storage, post goals, claim alliance majority control.
  - **Member**: can donate resources, use alliance ship, vote on goals.
- A player may belong to **one alliance at a time**.
- Alliance dissolution: Founder-only. Alliance credits refunded pro-rata to members; alliance ship storage contents returned to Founder.
- **Collective influence**: for majority control purposes, an alliance's combined influence from all members in a system is treated as a single block.

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

- The current **governance holder** of a system (steward or majority controller) may set a **mining royalty rate** (0–20%) on all resource extraction within their system.
- When an Extractor owned by a non-governance player produces resources in that system, the royalty percentage is credited to the governance holder in Credits.
- Royalty rates are set per-system and apply to all bodies in the system.
- Royalty changes take effect on the next extraction tick.
- If a player both holds governance and operates the extractor, no royalty is deducted.
- If governance is currently **ungoverned** (no active steward or majority controller), no royalty is charged until governance is re-established.

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
| **Stabilized Wormhole** | Creates a persistent two-way lane between two player-governed systems. Counts against lane cap. Does not require gate at far endpoint. |
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
7. **Server authority is unchanged**: Premium items do not short-circuit server resolution of claims, auctions, lane construction, or gate governance.
8. **Wormholes require governance**: The Stabilized Wormhole still requires the player to hold governance at their source system.
9. **Emergency exchange is credit-only**: The Universal Exchange (§19) accepts only Credits, which cannot be bought with real money.

---

## 16. Multiplayer Visibility

Because the game has no live real-time simulation, multiplayer presence is conveyed through:

- **Activity indicators**: "Last active X hours ago" per colony/system, visible to all visitors.
- **Shared lane and gate network**: The hyperspace lane map and gate locations are visible to all players and show ownership/governance.
- **System influence panel**: For each discovered system, a breakdown of current influence by player/alliance is visible.
- **Governance status**: Each system displays its steward (discovery credit holder) and current governance holder distinctly.
- **Market listings**: All regional market listings are publicly visible.
- **Alliance roster**: Public alliance membership list and in-progress goals.
- **Auction boards**: All active auctions are visible galaxy-wide.
- **Discovery log**: Global feed of recent first-discoveries (system name, discoverer handle, timestamp).
- **World changes feed**: Scrollable log of major events: new colonies, stewardship transfers, majority control events, system sales, large trades, alliance formations, gate constructions, colony collapses.
- **No live ship rendering**: Ships are not rendered as moving objects. A ship's presence at a location is shown only after arrival is resolved.

---

## 17. Contested Claims and Resolution

- Claims and lane/gate constructions are the primary competitive actions in the game.
- **Resolution rule**: The action whose `complete_at` timestamp (arrival time + deployment duration) is **earliest** wins.
- If two players share the same `complete_at` timestamp (within 1 second), the server uses insertion order (lower primary-key ID wins).
- Losers of a contested claim are notified, and their deployment action is fully refunded (resources returned, colony slot not consumed).
- There is **no claim queue** — only first completion wins.
- This rule applies to: colony claims, stewardship registration, and gate construction at a system.
- **Stewardship contention**: if two players discover a system simultaneously (within 1 second), stewardship follows the same tie-break rule (lower UUID wins). Discovery credit is awarded to the winner; the other player still gets a discovery record but no stewardship.

---

## 18. Pre-Colony Travel

- Before placing their first colony, a player's ship may traverse **any public lane for free** (transit tax = 0).
- The player still must travel via lanes (cannot teleport to unreachable systems).
- The free-travel window ends the moment the player's first colony claim is finalized server-side.
- This prevents new players from being economically blocked from exploring or reaching their desired colony site.

---

## 19. Emergency Universal Exchange

The Emergency Universal Exchange (EUX) is an NPC-backed safety-valve market for **common resources only** (Iron, Carbon, Ice). It exists to prevent total resource starvation in the early game and is intentionally priced above player market levels.

### Rules

- **Scope**: Iron, Carbon, and Ice only. No refined or rare resources.
- **Pricing**: Fixed at `EUX_MARKUP × configured floor price` per unit (default: 5× the floor). Prices do not fluctuate.
- **Payment**: Credits only. Credits are burned (removed from supply) — no seller receives them.
- **Daily limit**: A per-player daily purchase cap applies (default: 500 units/day across all resource types combined).
- **No ship required**: EUX purchases deliver directly to the buying player's designated colony storage. No travel required.
- **Accessible from**: any system where the player has a colony.

### Design intent

- The EUX is a **fallback**, not a substitute for the player market. Its high price ensures the player market is always the preferred choice when resources are available.
- The EUX acts as a deflationary sink (burning credits) which partially offsets colony tax emission.
- The EUX is not available to alliances — only to individual players.

---

## 20. Inactivity and Colony Collapse

Long-term inactivity must not allow permanently abandoned empires to lock away bodies, system influence, or gate governance indefinitely. The inactivity-collapse system recycles abandoned assets.

### 20.1 Inactivity threshold

- A player is considered **inactive** when they have not logged in for **30 consecutive days** (measured by `players.last_active_at`).
- Inactivity is evaluated lazily (server checks on relevant actions, not via background cron).

### 20.2 Abandoned state

When a player crosses the inactivity threshold, **all of their colonies** enter the **abandoned** state:

- Abandoned colonies **stop generating**:
  - Resource extraction (Extractors idle).
  - Tax income.
  - System influence (influence contribution drops to zero immediately on abandonment).
- Abandoned colonies are **visible** to other players as abandoned (activity indicator shows status).
- The colony body is **not yet claimable** during the abandonment window.
- Abandonment is recorded as `abandoned_at` on the colony row. A `colony_abandoned` world event is emitted.

### 20.3 Resolution window and collapse

- After a colony enters abandoned state, there is a **7-day resolution window** during which the player may log back in and reactivate their colonies (colonies immediately return to active state; no resource cost).
- If the player does not log in within the resolution window, all abandoned colonies **collapse**:
  - Colony `status` changes to `collapsed`.
  - Colony `collapsed_at` is recorded.
  - All structures on the body remain physically (as ruins) but are inactive.
  - Resources stored in the colony are cleared.
  - The body becomes **claimable** by any player (treated as unclaimed for claim purposes).
  - A `colony_collapsed` world event is emitted.

### 20.4 Infrastructure after collapse

- **Structures on collapsed bodies** become ruins (inactive, `is_active = FALSE`). A new colony owner may pay a salvage cost (resources) to repair and reactivate them, or demolish them.
- **Hyperspace gates** remain in the world as neutral gates. They are not deleted. Any player may traverse them (public access) until the new governance holder reclaims and configures them.
- **Hyperspace lanes** built through a neutral gate remain active.
- **Stewardship** of a system is not lost when the steward's colonies collapse — only their governance is affected. If the steward loses governance due to collapse and no majority controller exists, the system is temporarily ungoverned until new governance forms.

### 20.5 Reactivation

- A player who returns after the resolution window has passed (colonies collapsed) may reclaim their former colony bodies as if they were new claims. No special treatment — same rules as any player claiming an unclaimed body.
- There is no penalty for returning, but all prior colony progress is lost.

---

## 21. Player Core Station

Every player has exactly one **core station** — their permanent hub in the galaxy.

### 21.1 What the core station is

- The core station is a first-class player-owned asset, distinct from ships and colonies.
- It serves as the player's central logistics node: the destination resources flow toward and the point from which orders are dispatched.
- Future cosmetic items (station skins) will apply to the station.

### 21.2 Starting location and movement

- All core stations begin at **Sol** (the shared starter system).
- The station can be relocated, but movement is **significantly slower than ships**. Station movement is a strategic, long-horizon decision — not a frequent action.
- Station movement is a timestamp-based job, like travel (start timestamp + calculated duration).
- While the station is in transit, its logistics role is suspended until arrival resolves.

### 21.3 Station inventory

- The core station maintains a **resource inventory** (the same `resource_inventory` table used by colonies and ships, with `location_type = 'station'`).
- Colonies are not the final destination of the resource economy. The long-term design is: **Extractors on colonies produce resources → ships transport resources → station stores and processes them** for construction, market listing, and alliance operations.

### 21.4 What the station does not do (alpha scope)

- The station does not produce taxes or resources directly.
- The station does not have structures in alpha.
- Full station automation (auto-dispatch queues, station-side processing) is a post-alpha feature.

---

## 22. Sol Safety Stipend

To prevent new players from becoming completely softlocked before establishing their first colony economy:

- Players who are **at or below a low credit threshold** (default: 50 credits) and have not received a stipend in the last 24 hours will receive a small daily credit grant (default: 25 credits) when they load the game.
- This stipend is applied lazily (checked at login/page load) — no background job required.
- The stipend is intentionally **very small**. It is a floor, not an income source. A single Tier 1 colony generates 10 credits/hour, making the stipend negligible within hours of founding a colony.
- The stipend is only available while the player's balance is at or below the threshold. It stops the moment the player has meaningful income.
- This is not an exploitable income source: the credit threshold ensures it only activates in genuine early-game hardship.
