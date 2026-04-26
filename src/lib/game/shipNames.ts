/**
 * Random ship name generator.
 * Ships are cosmetically differentiated by skins, not by stats.
 * Each ship gets a unique procedurally-generated designation.
 */

const PREFIXES = [
  "Aether", "Apex", "Arc", "Ariel", "Arrow", "Astral", "Atlas", "Aurora",
  "Blaze", "Bolt", "Bright", "Caelum", "Cascade", "Cinder", "Cirrus", "Cobalt",
  "Comet", "Corona", "Crest", "Crimson", "Crystal", "Cyan", "Dawn", "Delta",
  "Drift", "Dusk", "Echo", "Ember", "Epoch", "Equinox", "Eris", "Ether",
  "Fable", "Flare", "Flash", "Flux", "Forge", "Frost", "Fulcrum", "Gale",
  "Gust", "Haven", "Helios", "Herald", "Horizon", "Ikon", "Ion", "Iron",
  "Jade", "Jett", "Kairos", "Kestrel", "Lance", "Lapis", "Lexi", "Lumen",
  "Lynx", "Mach", "Mantis", "Mirage", "Mist", "Mythic", "Nadir", "Nexus",
  "Nova", "Nox", "Obsidian", "Onyx", "Orbit", "Orion", "Paladin", "Paragon",
  "Peak", "Photon", "Pilot", "Pinnacle", "Pioneer", "Polar", "Prism", "Probe",
  "Pulsar", "Quantum", "Quasar", "Radian", "Raptor", "Raven", "Ray", "Rift",
  "Rigel", "Rise", "River", "Rogue", "Ruby", "Sable", "Sage", "Sentinel",
  "Shard", "Shift", "Signal", "Silver", "Sirius", "Slate", "Sol", "Solar",
  "Solace", "Specter", "Spirit", "Sprint", "Star", "Starfall", "Steel",
  "Sterling", "Storm", "Stride", "Summit", "Surge", "Tempest", "Terra",
  "Titan", "Toggle", "Trace", "Trek", "Trident", "Trinity", "Triton", "Ultra",
  "Vector", "Velocity", "Venture", "Vex", "Void", "Volt", "Vortex", "Vow",
  "Warden", "Wave", "Wisp", "Wrath", "Zenith", "Zephyr", "Zero", "Zinc",
];

const SUFFIXES = [
  "Actual", "Alpha", "Ascent", "Blade", "Beacon", "Bear", "Beta", "Blaze",
  "Bound", "Break", "Breaker", "Bright", "Call", "Charge", "Chase", "Chief",
  "Claim", "Class", "Cleave", "Cloud", "Comet", "Core", "Craft", "Crest",
  "Cross", "Crown", "Dash", "Dawn", "Deck", "Dive", "Drift", "Drive",
  "Edge", "Fall", "Far", "Field", "Find", "Fire", "First", "Flair",
  "Flare", "Fleet", "Flight", "Flint", "Fly", "Force", "Forge", "Gale",
  "Gate", "Glide", "Glow", "Guard", "Guide", "Hand", "Hard", "Haze",
  "Heart", "High", "Hold", "Hope", "Hunt", "Hunter", "Jag", "Jump",
  "Keep", "Kind", "Lance", "Law", "Leap", "Light", "Line", "Link",
  "Lure", "Mark", "Meld", "Mesh", "Mind", "Mist", "Moon", "Naut",
  "Night", "Null", "Open", "Own", "Pace", "Path", "Peak", "Pierce",
  "Pilot", "Point", "Pulse", "Race", "Reach", "Rift", "Rise", "Road",
  "Roam", "Roll", "Rough", "Rover", "Run", "Rush", "Sail", "Scope",
  "Scout", "Search", "Seeker", "Send", "Shard", "Shine", "Shift",
  "Side", "Sign", "Sight", "Skate", "Sky", "Soar", "Span", "Speed",
  "Spike", "Spin", "Split", "Spur", "Stack", "Star", "Stead", "Streak",
  "Strike", "Strong", "Surge", "Tail", "Tear", "Tide", "Trail", "Trace",
  "Trek", "True", "Trust", "Tune", "Vault", "View", "Wake", "Walk",
  "Ward", "Watch", "Way", "Wing", "Wire", "Wish", "Worth", "Wraith",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a unique-feeling ship designation like "Nova Drift" or "Ember Wing IV". */
export function randomShipName(): string {
  const prefix = pick(PREFIXES);
  const suffix = pick(SUFFIXES);
  // Avoid doubling the same word
  if (prefix.toLowerCase() === suffix.toLowerCase()) return randomShipName();
  const roman = Math.random() < 0.35 ? pick(["II", "III", "IV", "V", "VI"]) : null;
  return roman ? `${prefix} ${suffix} ${roman}` : `${prefix} ${suffix}`;
}
