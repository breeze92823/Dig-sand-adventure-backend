import type { MapSchema } from "@colyseus/schema";
import { LANE, LOOT, LUCK_LOOT, X1_DROPS } from "./constants.js";
import { LOOT_CATALOG } from "./data/lootCatalog.js";
import { LootState } from "./rooms/schema/WorldState.js";

// Server-owned loot for the dig lane. The lane is tiled into piles (same scheme as the client's
// spots.js); each pile of a band that drops loot holds 1..LUCK_LOOT.maxItems item slots. Every slot
// holds one item at a time: when it is claimed, or expires a while after being dug free, the slot
// refills with a freshly rolled item after a respawn delay. Everything is keyed by a unique id so a
// replaced item is never mistaken for the old one.

const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic", "Secret", "Celestial", "Divine"];
const POOLS: Record<string, [string, number][]> = {};
for (const [name, rarity, value] of LOOT_CATALOG) (POOLS[rarity] ??= []).push([name, value]);
// Rarity tiers that actually have items, lowest to highest.
const TIERS = RARITIES.filter((r) => POOLS[r]?.length);
const LAST_ZONE = LANE.zones - 1;

const dropCount = (zone: number) => 1 + Math.floor(((LUCK_LOOT.maxItems - 1) * zone) / LAST_ZONE);

function rollTier(zone: number): string {
  const pos = (zone / LAST_ZONE) * (TIERS.length - 1);
  let k = Math.floor(pos);
  if (Math.random() < pos - k) k++;
  if (Math.random() < LUCK_LOOT.bonus) k++;
  return TIERS[Math.min(k, TIERS.length - 1)];
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pile = { zone: number; x: number; z: number; rarity?: string };

const nx = Math.max(1, Math.round((2 * LANE.halfWidth) / LANE.pile));
const nz = Math.max(1, Math.round(LANE.zoneLen / LANE.pile));
function pilesOf(zone: number): Pile[] {
  const list: Pile[] = [];
  for (let pz = 0; pz < nz; pz++) {
    for (let px = 0; px < nx; px++) {
      list.push({
        zone,
        x: -LANE.halfWidth + ((px + 0.5) * 2 * LANE.halfWidth) / nx,
        z: LANE.laneStartZ - zone * LANE.zoneLen - ((pz + 0.5) * LANE.zoneLen) / nz,
      });
    }
  }
  return list;
}

// The x1 band drops a fixed plan: one pile from each of `count` equal slices, `uncommon` of them Uncommon.
function x1Plan(): Pile[] {
  const zone0 = pilesOf(0);
  const count = Math.min(X1_DROPS.piles, zone0.length);
  const rand = mulberry32(5);
  const uncommonAt = new Set(Array.from({ length: X1_DROPS.uncommon }, (_, u) => Math.floor(((u + 0.5) * count) / X1_DROPS.uncommon)));
  return Array.from({ length: count }, (_, k) => {
    const lo = Math.floor((k * zone0.length) / count);
    const hi = Math.floor(((k + 1) * zone0.length) / count);
    return { ...zone0[lo + Math.floor(rand() * (hi - lo))], rarity: uncommonAt.has(k) ? "Uncommon" : "Common" };
  });
}

// Every pile that holds loot: the x1 plan, plus each higher-band pile with a rising chance.
function layout(): Pile[] {
  const zone0 = pilesOf(0);
  const share = X1_DROPS.piles / zone0.length;
  const spots = x1Plan();
  for (let zone = 1; zone < LANE.zones; zone++) {
    const chance = Math.min(1, share + (1 - share) * (zone / LUCK_LOOT.fullAt));
    for (const p of pilesOf(zone)) if (Math.random() < chance) spots.push(p);
  }
  return spots;
}

interface Slot {
  x: number;
  z: number;
  zone: number;
  rarity?: string; // fixed rarity (x1 plan), else rolled for the band
  gen: number;
  id: string | null; // key of the item currently lying in this slot
}

export class LootWorld {
  readonly slots: Slot[] = [];
  private respawnAt = new Map<number, number>(); // slot index -> epoch ms its item respawns
  private expireAt = new Map<number, number>(); // slot index -> epoch ms its dug-free item disappears
  private slotOf = new Map<string, number>(); // item id -> slot index

  constructor(private readonly state: MapSchema<LootState>) {
    for (const s of layout()) {
      const n = s.rarity ? 1 : dropCount(s.zone);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + Math.PI / 4;
        const r = n > 1 ? LANE.ring : 0;
        this.slots.push({ x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r, zone: s.zone, rarity: s.rarity, gen: 0, id: null });
      }
    }
    for (let i = 0; i < this.slots.length; i++) this.spawn(i);
  }

  private spawn(i: number) {
    const s = this.slots[i];
    const pool = POOLS[s.rarity ?? rollTier(s.zone)];
    const [name, value] = pool[Math.floor(Math.random() * pool.length)];
    const rarity = s.rarity ?? TIERS.find((r) => POOLS[r] === pool)!;
    const item = new LootState();
    item.name = name;
    item.rarity = rarity;
    item.value = value;
    item.x = Math.round(s.x * 100) / 100;
    item.z = Math.round(s.z * 100) / 100;
    s.id = `${i}.${++s.gen}`;
    this.state.set(s.id, item);
    this.slotOf.set(s.id, i);
  }

  // Removes the slot's item and queues its refill.
  private vacate(i: number, now: number) {
    const s = this.slots[i];
    if (s.id) {
      this.state.delete(s.id);
      this.slotOf.delete(s.id);
      s.id = null;
    }
    this.expireAt.delete(i);
    const jitter = 0.8 + Math.random() * 0.4;
    this.respawnAt.set(i, now + (LOOT.respawnBase + LOOT.respawnPerZone * s.zone) * 1000 * jitter);
  }

  // A player dug the item free: its disappear countdown starts (only the first report counts).
  free(id: string, now: number): boolean {
    const i = this.slotOf.get(id);
    const item = this.state.get(id);
    if (i === undefined || !item || item.expiresAt > 0) return false;
    item.expiresAt = now + LOOT.lifetime * 1000;
    this.expireAt.set(i, item.expiresAt);
    return true;
  }

  // First valid claim wins: returns the item, or null when it is gone / not dug free yet.
  claim(id: string, now: number): { name: string; rarity: string; value: number; x: number; z: number } | null {
    const i = this.slotOf.get(id);
    const item = this.state.get(id);
    if (i === undefined || !item || item.expiresAt <= 0) return null;
    const out = { name: item.name, rarity: item.rarity, value: item.value, x: item.x, z: item.z };
    this.vacate(i, now);
    return out;
  }

  // Expires dug-free items past their time and refills slots whose respawn is due.
  tick(now: number) {
    for (const [i, at] of this.expireAt) if (now >= at) this.vacate(i, now);
    for (const [i, at] of this.respawnAt) {
      if (now < at) continue;
      this.respawnAt.delete(i);
      this.spawn(i);
    }
  }
}
