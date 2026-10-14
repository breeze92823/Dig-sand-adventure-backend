import { MongoClient, type Collection } from "mongodb";

// Bloxity Legion hosting injects MONGODB_URI per game+channel -- an isolated database with
// scoped credentials. A local `npm start` normally has no Mongo reachable, so a missing or
// unreachable URI must degrade to "no persistence" rather than crash the room.

export interface LootDoc {
  name: string;
  rarity: string;
  value: number;
}

// One owned pet (client pets.js): `id` is the per-account instance id, `pid` the species.
export interface PetDoc {
  id: number;
  pid: string;
  equipped: boolean;
}

// Daily Rewards progress (client daily.js): rewards claimed this week, week number, UTC date (YYYY-MM-DD) of the last claim.
export interface DailyDoc {
  day: number;
  week: number;
  last: string;
}
// Active timed boosts (client boosts.js), `until` = server epoch ms.
export type BoostsDoc = Record<string, { mult: number; until: number }>;

// Mirrors the persisted half of the client's `player` singleton (src/player.js and the windows).
export interface PlayerDoc {
  _id: string; // Bloxity user id -- see WorldRoom.ts (guests are never saved)
  // Display name as of the last save, so an offline leaderboard row still has something to show.
  username?: string;
  // Bloxity avatar JSON as last reported, so a board's top row can still be dressed offline.
  avatar?: string;
  money?: number;
  strength?: number;
  level?: number;
  xp?: number;
  xpNext?: number;
  rebirths?: number;
  sand?: number;
  bag?: LootDoc[];
  sellLocked?: string[]; // loot names locked against Sell All
  found?: string[]; // Index: loot names ever picked up
  shovels?: string[]; // owned shovel ids
  shovel?: string; // equipped shovel id
  trails?: string[]; // owned trail ids
  trail?: string | null; // equipped trail id
  upgrades?: Record<string, number>;
  pets?: PetDoc[];
  nextPetId?: number;
  discovered?: string[]; // pet species ever hatched
  daily?: DailyDoc;
  boosts?: BoostsDoc;
  tutorialStep?: number; // new-player tutorial progress; a doc without it predates the tutorial (client treats it as finished)
  version: number;
  updatedAt: Date;
}

let client: MongoClient | null = null;
let players: Collection<PlayerDoc> | null = null;

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[db] MONGODB_URI not set -- player progress will not persist");
    return;
  }
  try {
    client = new MongoClient(uri);
    await client.connect();
    // No dbName passed to .db() -- the injected URI already points at this game+channel's database.
    players = client.db().collection<PlayerDoc>("players");
    console.log("[db] connected to MongoDB");

    // refreshLeaderboard() sorts by each of these; createIndex is idempotent. A failure only
    // means those queries stay unindexed, never blocks startup.
    try {
      await players.createIndex({ strength: -1 });
      await players.createIndex({ rebirths: -1 });
      await players.createIndex({ level: -1 });
      await players.createIndex({ money: -1 });
    } catch (err) {
      console.warn("[db] failed to create leaderboard indexes:", err);
    }
  } catch (err) {
    console.warn("[db] connect failed -- player progress will not persist:", err);
    client = null;
    players = null;
  }
}

// Null whenever Mongo is unset/unreachable -- every caller must treat that as "skip persistence".
export function getPlayers(): Collection<PlayerDoc> | null {
  return players;
}

// Test-only seam: exercise the leaderboard/save logic against an in-memory fake collection.
export function __setPlayersForTest(fake: Collection<PlayerDoc> | null): void {
  players = fake;
}
