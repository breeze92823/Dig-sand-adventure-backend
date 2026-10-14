import { schema, t, type SchemaType } from "@colyseus/schema";
import { SPAWN } from "../../constants.js";

// The live roster: everything other clients need to draw this player. The server stores and
// relays it; the game is client-authoritative. Durable progress lives in Mongo (src/db.ts).
// To sync something new about a character, add a field here and accept it in WorldRoom's
// `pose` / `set*` handlers.
export const PlayerState = schema(
  {
    username: t.string().default(""), // client-reported Bloxity displayName/username, not validated
    x: t.float64().default(SPAWN.x),
    y: t.float64().default(SPAWN.y),
    z: t.float64().default(SPAWN.z),
    yaw: t.float64().default(0),
    speed01: t.float64().default(0), // 0..1 gait factor -- purely cosmetic
    grounded: t.boolean().default(true),
    pose: t.string().default(""), // client animation name ("" = none), e.g. "dig"
    // Equipped shovel id (client data/shovels.js), drawn in the player's hands.
    shovel: t.string().default("wooden"),
    // Equipped trail id (client data/trails.js), "" = none.
    trail: t.string().default(""),
    // Equipped pet species ids, comma separated (client data/pets.js), "" = none. Followers are cosmetic.
    pets: t.string().default(""),
    // The player's Bloxity avatar { equipped, proportions } as an opaque JSON string,
    // stored and relayed as-is (length-capped, never parsed here).
    avatar: t.string().default(""),
    // What the leaderboards rank (client player.js): mirrored from saves.
    strength: t.float64().default(0),
    rebirths: t.float64().default(0),
    level: t.float64().default(1),
    money: t.float64().default(0),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

// One shared piece of loot lying in the dig lane (src/loot.ts), keyed by a unique id.
export const LootState = schema(
  {
    name: t.string().default(""),
    rarity: t.string().default("Common"),
    value: t.float64().default(0),
    x: t.float64().default(0),
    z: t.float64().default(0),
    // Epoch ms the item disappears at; 0 until a player has dug it free (the countdown starts then).
    expiresAt: t.float64().default(0),
  },
  "LootState",
);
export type LootState = SchemaType<typeof LootState>;

export const WorldState = schema(
  {
    players: t.map(PlayerState), // keyed by sessionId
    loot: t.map(LootState), // keyed by item id
  },
  "WorldState",
);
export type WorldState = SchemaType<typeof WorldState>;
