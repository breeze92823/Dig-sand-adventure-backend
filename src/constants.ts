// Keep in step with the client's src/config.js and src/data/*.js by hand.
export const ROOM_MAX_CLIENTS = 50;

// Where a player appears for everyone else before their first `pose` arrives (client SPAWN).
export const SPAWN = { x: 0, y: 0.3, z: 4 };

// Walkable bounds (client WORLD_BOUNDS: the hub plus the dig lane north to the sea, z = -718),
// with a little slack: a forged pose cannot put a player outside the world for everyone else to see.
export const WORLD_BOUNDS = { minX: -120, maxX: 120, minZ: -730, maxZ: 56, minY: -40, maxY: 200 };

// Longest accepted strings.
export const NAME_MAX = 64;
export const POSE_MAX = 32;
// Bloxity avatar JSON, relayed as-is. Kept under the 4 KB cap of the join request's options.
export const AVATAR_MAX_LEN = 3000;

// Colyseus drops the whole connection for a WebSocket message above this (default 4 KB).
export const MAX_PAYLOAD_BYTES = 128 * 1024;

// Leaderboards: how often WorldRoom re-queries Mongo for the all-time top players per stat, how
// many rows it fetches per stat before merging with the live roster, and how many it sends.
export const LEADERBOARD_REFRESH_MS = 15_000;
export const LEADERBOARD_QUERY_LIMIT = 20;
export const LEADERBOARD_ROWS = 10;

// How long a dropped connection (WiFi blip, backgrounded tab) may reconnect with the same session.
export const RECONNECT_SECONDS = 20;

// Upper bounds for saved values, so a forged payload cannot push a bogus number onto the
// leaderboards. Generous ceilings, not game rules.
export const CURRENCY_MAX = 1_000_000_000_000_000_000; // money, strength, xp, sand
export const REBIRTH_MAX = 1_000_000;
export const LEVEL_MAX = 1_000_000;
export const BAG_SAVE_MAX = 200; // client player.bagSlots is 3 + capacity upgrades
export const FOUND_MAX = 2_000; // Index entries (loot names)
export const LOCKED_MAX = 200; // names locked against Sell All
export const ITEM_VALUE_MAX = 1_000_000_000_000;
export const TEXT_MAX = 64; // item names
export const PETS_STORAGE_MAX = 60; // client pets.js PETS.storage
export const PETS_EQUIP_MAX = 3; // client pets.js PETS.equipSlots
export const DAILY_DAYS = 7; // client daily.js REWARDS.length
export const DAILY_WEEK_MAX = 1_000_000;
export const BOOST_KINDS: readonly string[] = ["strength", "cash"]; // client boosts.js
export const BOOST_MULT_MAX = 1_000;
export const BOOST_UNTIL_MAX = 8_640_000_000_000_000; // epoch ms ceiling (JS Date range)
export const PET_UID_MAX = 1_000_000_000; // per-pet instance ids (player.nextPetId)

// Client data/loot.js RARITIES (loot in the Bag).
export const RARITIES: readonly string[] = [
  "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Secret", "Celestial", "Divine",
];

// Client config.js UPGRADES ids with their max levels (capacity: 17 extra backpack slots; the rest are
// uncapped in the client, so a generous ceiling).
export const UPGRADE_MAX: Readonly<Record<string, number>> = {
  range: 10_000, agility: 10_000, capacity: 17, mobility: 10_000, value: 10_000, magnet: 10_000,
};

// Client data/shovels.js (the two Celestial quest/daily rewards, eclipse and galaxy, are not buyable
// but can be owned once earned), data/trails.js and data/pets.js ids.
export const SHOVEL_IDS: readonly string[] = [
  "wooden", "driftwood", "rusty", "bronze", "steel", "iron", "verdant", "jade", "gold", "amber", "sunstone",
  "sapphire", "diamond", "amethyst", "frost", "storm", "obsidian", "inferno", "phoenix", "rune", "nebula",
  "relic", "aurora", "solar", "comet", "genesis", "dunecrest", "jadefang", "drill", "galaxy", "eclipse",
];
export const START_SHOVEL = "wooden";
export const TRAIL_IDS: readonly string[] = [
  "sand", "green", "blue", "goldensand", "lunarsand", "purple", "red", "yellow", "orange", "teal",
  "magenta", "crimson", "violet", "cyan", "onyx",
];
// Client config.js TUTORIAL.steps: the onboarding runs steps 0..TUTORIAL_DONE_STEP (11 = finished).
export const TUTORIAL_DONE_STEP = 11;

export const PET_IDS: readonly string[] = [
  "piggy", "cat", "bunny", "fox", "dragon",
  "frog", "panda", "wolf", "owl", "unicorn",
  "koala", "tiger", "lion", "phoenix", "nebula",
];

// The client's per-browser fallback id for players who are not signed in to Bloxity.
// Guests are never persisted.
export const GUEST_ID_PREFIX = "guest-";

// Shared dig-lane loot (src/loot.ts). Lane geometry mirrors the client's HUB (config.js): the lane runs north
// from the plaza edge `laneStartZ`, `halfWidth` either side of x = 0, in `zones` equal bands of `zoneLen` m
// (luck x1 ... x60). Drop rules mirror data/loot.js LUCK_LOOT / X1_DROPS.
export const LANE = { halfWidth: 13, laneStartZ: -14, zoneLen: (3 * (246 - 14)) / 13, zones: 13, pile: 6, ring: 1.6 };
export const LUCK_LOOT = { fullAt: 4, maxItems: 4, bonus: 0.1 };
export const X1_DROPS = { piles: 24, uncommon: 6 };
export const LOOT = {
  // A claimed or expired item's spot refills after respawnBase + respawnPerZone * band seconds (+-20%).
  respawnBase: 40,
  respawnPerZone: 4,
  // Seconds an item stays once a player has dug it free (first `lootFreed`), then it disappears and respawns.
  lifetime: 150,
  // Max distance (m) from a player's last pose to the item for `claimLoot` / `lootFreed` (client pickup range
  // is 2.4 m x the Magnet upgrade, so this is generous).
  claimRange: 12,
  freedRange: 25,
  tickMs: 1000,
};
