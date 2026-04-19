/**
 * Premium shop catalog — item definitions, prices, and metadata.
 * Prices are in USD cents (e.g. 299 = $2.99).
 */

import type { PremiumItemType } from "@/lib/types/enums";

export interface ShopItem {
  type: PremiumItemType;
  /** Short display name */
  name: string;
  /** One-sentence description shown on the card */
  description: string;
  /** Price in USD cents */
  priceCents: number;
  /** Cosmetics are never consumed after purchase; utility items are single-use. */
  category: "cosmetic" | "utility";
  /**
   * Whether the player can hold multiple unconsumed copies simultaneously.
   * Only meaningful for utility items — cosmetics are effectively permanent.
   */
  stackable: boolean;
}

export const SHOP_CATALOG: ShopItem[] = [
  // ── Cosmetics ────────────────────────────────────────────────────────────
  {
    type: "ship_skin",
    name: "Ship Skin",
    description: "A custom visual skin applied to one of your ships. Purely cosmetic.",
    priceCents: 299,
    category: "cosmetic",
    stackable: true,
  },
  {
    type: "colony_banner",
    name: "Colony Banner",
    description: "A unique flag or banner displayed on one of your colonies.",
    priceCents: 199,
    category: "cosmetic",
    stackable: true,
  },
  {
    type: "vanity_name_tag",
    name: "Vanity Name Tag",
    description:
      "Attach a custom label to a star system, displayed alongside its canonical name.",
    priceCents: 299,
    category: "cosmetic",
    stackable: true,
  },
  {
    type: "alliance_emblem",
    name: "Alliance Emblem",
    description: "A decorative emblem shown on your alliance's public profile.",
    priceCents: 499,
    category: "cosmetic",
    stackable: false,
  },
  {
    type: "discoverer_monument",
    name: "Discoverer Monument",
    description:
      "A commemorative marker placed on a system you were the first to discover.",
    priceCents: 399,
    category: "cosmetic",
    stackable: false,
  },
  // ── Utility (single-use) ─────────────────────────────────────────────────
  {
    type: "unstable_warp_tunnel",
    name: "Unstable Warp Tunnel",
    description:
      "Creates a temporary one-way lane to any discovered system, ignoring range limits. Single use.",
    priceCents: 499,
    category: "utility",
    stackable: true,
  },
  {
    type: "stabilized_wormhole",
    name: "Stabilized Wormhole",
    description:
      "Creates a persistent two-way lane between two player-governed systems. Counts against lane cap.",
    priceCents: 999,
    category: "utility",
    stackable: true,
  },
  {
    type: "deep_survey_kit",
    name: "Deep Survey Kit",
    description:
      "Reveals rare or hidden resource nodes on a body that a basic survey would not find.",
    priceCents: 299,
    category: "utility",
    stackable: true,
  },
  {
    type: "colony_permit",
    name: "Colony Permit",
    description:
      "Grants +1 additional colony slot. Maximum 2 permits per account lifetime.",
    priceCents: 1499,
    category: "utility",
    stackable: false,
  },
];

export function findShopItem(type: PremiumItemType): ShopItem | undefined {
  return SHOP_CATALOG.find((i) => i.type === type);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
