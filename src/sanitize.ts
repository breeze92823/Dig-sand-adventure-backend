import {
  CURRENCY_MAX, REBIRTH_MAX, LEVEL_MAX, BAG_SAVE_MAX, FOUND_MAX, LOCKED_MAX, ITEM_VALUE_MAX, TEXT_MAX,
  RARITIES, UPGRADE_MAX, SHOVEL_IDS, TRAIL_IDS, PET_IDS, PETS_STORAGE_MAX, PETS_EQUIP_MAX, PET_UID_MAX,
  DAILY_DAYS, DAILY_WEEK_MAX, BOOST_KINDS, BOOST_MULT_MAX, BOOST_UNTIL_MAX, TUTORIAL_DONE_STEP,
} from "./constants.js";
import type { BoostsDoc, DailyDoc, LootDoc, PetDoc, PlayerDoc } from "./db.js";

export function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
export function clampNum(v: number, max: number): number {
  return Math.min(max, Math.max(0, v));
}
export function clampInt(v: number, max: number, min = 0): number {
  return Math.min(max, Math.max(min, Math.floor(v)));
}
function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function text(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= TEXT_MAX ? v : null;
}

// Carried loot { name, rarity, value }.
export function sanitizeBag(raw: unknown): LootDoc[] {
  if (!Array.isArray(raw)) return [];
  const out: LootDoc[] = [];
  for (const it of raw.slice(0, BAG_SAVE_MAX)) {
    if (!isObject(it)) continue;
    const name = text(it.name);
    if (!name || typeof it.rarity !== "string" || !RARITIES.includes(it.rarity) || !finite(it.value)) continue;
    out.push({ name, rarity: it.rarity, value: clampNum(it.value, ITEM_VALUE_MAX) });
  }
  return out;
}

// Loot names (Index entries, locked items): short strings, no duplicates, capped.
export function sanitizeNames(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(text).filter((n): n is string => n !== null))].slice(0, max);
}

// Known ids only, no duplicates (owned shovels / trails, hatched pet species).
export function sanitizeIds(raw: unknown, known: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && known.includes(id)))];
}

// { range: 3, ... } -> known upgrade ids with integer levels, capped at each upgrade's max.
function sanitizeUpgrades(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(raw)) return out;
  for (const [id, max] of Object.entries(UPGRADE_MAX)) if (finite(raw[id])) out[id] = clampInt(raw[id] as number, max);
  return out;
}

// Owned pets [{ id, pid, equipped }]: known species, unique integer instance ids, at most
// PETS_STORAGE_MAX of them and PETS_EQUIP_MAX equipped.
export function sanitizePets(raw: unknown): PetDoc[] {
  if (!Array.isArray(raw)) return [];
  const out: PetDoc[] = [];
  const seen = new Set<number>();
  let equipped = 0;
  for (const it of raw) {
    if (out.length >= PETS_STORAGE_MAX) break;
    if (!isObject(it) || !finite(it.id) || typeof it.pid !== "string" || !PET_IDS.includes(it.pid)) continue;
    const id = clampInt(it.id, PET_UID_MAX);
    if (seen.has(id)) continue;
    seen.add(id);
    const equip = it.equipped === true && equipped < PETS_EQUIP_MAX;
    if (equip) equipped++;
    out.push({ id, pid: it.pid, equipped: equip });
  }
  return out;
}

// { day, week, last }: day 0..6, week >= 1, last a YYYY-MM-DD string (or empty).
export function sanitizeDaily(raw: unknown): DailyDoc | null {
  if (!isObject(raw) || !finite(raw.day) || !finite(raw.week)) return null;
  const last = typeof raw.last === "string" && /^(\d{4}-\d{2}-\d{2})?$/.test(raw.last) ? raw.last : "";
  return { day: clampInt(raw.day, DAILY_DAYS - 1), week: clampInt(raw.week, DAILY_WEEK_MAX, 1), last };
}

// { strength: { mult, until }, cash: { ... } }: known kinds only, bounded numbers.
export function sanitizeBoosts(raw: unknown): BoostsDoc {
  const out: BoostsDoc = {};
  if (!isObject(raw)) return out;
  for (const kind of BOOST_KINDS) {
    const b = raw[kind];
    if (isObject(b) && finite(b.mult) && finite(b.until)) {
      out[kind] = { mult: Math.min(BOOST_MULT_MAX, Math.max(1, b.mult)), until: clampNum(b.until, BOOST_UNTIL_MAX) };
    }
  }
  return out;
}

// The game is client-authoritative -- no server-side gameplay validation. What IS enforced:
// shape and bounds, so a malformed payload can never corrupt this player's own Mongo document.
// A forged number can only ever affect the sender's own save and their leaderboard rows.
export function sanitizeProgress(raw: unknown): Partial<PlayerDoc> | null {
  if (!isObject(raw)) return null;
  const out: Partial<PlayerDoc> = {};

  for (const key of ["money", "strength", "xp", "xpNext", "sand"] as const) {
    if (finite(raw[key])) out[key] = clampNum(raw[key] as number, CURRENCY_MAX);
  }
  if (finite(raw.level)) out.level = clampInt(raw.level, LEVEL_MAX, 1);
  if (finite(raw.rebirths)) out.rebirths = clampInt(raw.rebirths, REBIRTH_MAX);
  if (raw.bag !== undefined) out.bag = sanitizeBag(raw.bag);
  if (raw.sellLocked !== undefined) out.sellLocked = sanitizeNames(raw.sellLocked, LOCKED_MAX);
  if (raw.found !== undefined) out.found = sanitizeNames(raw.found, FOUND_MAX);
  if (raw.shovels !== undefined) out.shovels = sanitizeIds(raw.shovels, SHOVEL_IDS);
  if (typeof raw.shovel === "string" && SHOVEL_IDS.includes(raw.shovel)) out.shovel = raw.shovel;
  if (raw.trails !== undefined) out.trails = sanitizeIds(raw.trails, TRAIL_IDS);
  if (raw.trail === null) out.trail = null;
  else if (typeof raw.trail === "string" && TRAIL_IDS.includes(raw.trail)) out.trail = raw.trail;
  if (raw.upgrades !== undefined) out.upgrades = sanitizeUpgrades(raw.upgrades);
  if (raw.pets !== undefined) out.pets = sanitizePets(raw.pets);
  if (finite(raw.nextPetId)) out.nextPetId = clampInt(raw.nextPetId, PET_UID_MAX + 1, 1);
  if (raw.discovered !== undefined) out.discovered = sanitizeIds(raw.discovered, PET_IDS);
  if (raw.daily !== undefined) {
    const daily = sanitizeDaily(raw.daily);
    if (daily) out.daily = daily;
  }
  if (raw.boosts !== undefined) out.boosts = sanitizeBoosts(raw.boosts);
  if (finite(raw.tutorialStep)) out.tutorialStep = clampInt(raw.tutorialStep, TUTORIAL_DONE_STEP);
  return out;
}

// What loadProgress sends down as tutorialStep: a doc that predates the tutorial belongs to a
// returning player, so a missing step reads as finished and they never see it.
export function resolveTutorialStep(doc: Partial<PlayerDoc>): number {
  return finite(doc.tutorialStep) ? clampInt(doc.tutorialStep, TUTORIAL_DONE_STEP) : TUTORIAL_DONE_STEP;
}
