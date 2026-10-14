import assert from "assert";
import type { Collection } from "mongodb";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { SPAWN, WORLD_BOUNDS } from "../src/constants.js";
import { __setPlayersForTest, type PlayerDoc } from "../src/db.js";

// waitForNextPatch() resolves on the server's tick, which can be before a
// connected client has decoded it; poll the client's view instead.
async function until(check: () => boolean, ms = 1000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

// Hand-rolled fake `players` collection implementing only the subset WorldRoom.ts calls:
// find().sort().limit().toArray(), updateOne() (upsert, $set, $max), findOne().
function fakePlayersCollection(seed: PlayerDoc[] = []) {
  const docs = new Map<string, PlayerDoc>(seed.map((d) => [d._id, d]));
  const fake = {
    docs,
    async findOne(filter: { _id: string }) {
      return docs.get(filter._id) ?? null;
    },
    async updateOne(filter: { _id: string }, update: any, options: any) {
      const existing = docs.get(filter._id);
      if (!existing && !options?.upsert) return { modifiedCount: 0 };
      const base = existing ?? ({ _id: filter._id, ...(update.$setOnInsert ?? {}) } as PlayerDoc);
      const next: any = { ...base, ...(update.$set ?? {}) };
      for (const [k, v] of Object.entries<number>(update.$max ?? {})) next[k] = Math.max(next[k] ?? -Infinity, v);
      docs.set(filter._id, next as PlayerDoc);
      return { modifiedCount: 1 };
    },
    find(_filter: any) {
      let sortField: string | null = null;
      let limitN = Infinity;
      const cursor = {
        sort(spec: Record<string, number>) {
          sortField = Object.keys(spec)[0];
          return cursor;
        },
        limit(n: number) {
          limitN = n;
          return cursor;
        },
        async toArray() {
          let arr = Array.from(docs.values());
          if (sortField) {
            const field = sortField;
            arr = arr.slice().sort((a: any, b: any) => (b[field] ?? 0) - (a[field] ?? 0));
          }
          return arr.slice(0, limitN);
        },
      };
      return cursor;
    },
  };
  return fake as unknown as Collection<PlayerDoc> & { docs: Map<string, PlayerDoc> };
}

describe("WorldRoom", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());
  beforeEach(async () => {
    await colyseus.cleanup();
  });
  afterEach(() => __setPlayersForTest(null));

  it("starts a joining player at the spawn, with their name and avatar", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const avatar = JSON.stringify({ equipped: { hatId: "3" }, proportions: { height: 1.2 } });
    const c1 = await colyseus.connectTo(room, { username: "Digger", avatar });
    const c2 = await colyseus.connectTo(room);
    await room.waitForNextPatch();

    const s = c2.state.players.get(c1.sessionId)!;
    assert.strictEqual(s.username, "Digger");
    assert.strictEqual(s.avatar, avatar);
    assert.strictEqual(s.x, SPAWN.x);
    assert.strictEqual(s.z, SPAWN.z);
    assert.strictEqual(s.shovel, "wooden");
  });

  it("relays pose to other players and sanitises it", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c1 = await colyseus.connectTo(room);
    const c2 = await colyseus.connectTo(room);
    await room.waitForNextPatch();

    c1.send("pose", { x: -60.5, y: 2, z: -300, yaw: 0.5, speed01: 7, grounded: false, pose: "dig" });
    await room.waitForNextPatch();
    const s = c2.state.players.get(c1.sessionId)!;
    assert.strictEqual(s.x, -60.5);
    assert.strictEqual(s.y, 2);
    assert.strictEqual(s.z, -300);
    assert.strictEqual(s.yaw, 0.5);
    assert.strictEqual(s.speed01, 1); // clamped to 0..1
    assert.strictEqual(s.grounded, false);
    assert.strictEqual(s.pose, "dig");

    // NaN is ignored, null clears the pose, out-of-world positions are clamped.
    c1.send("pose", { x: NaN, z: 99999, pose: null });
    await room.waitForNextPatch();
    const s2 = c2.state.players.get(c1.sessionId)!;
    assert.strictEqual(s2.x, -60.5);
    assert.strictEqual(s2.z, WORLD_BOUNDS.maxZ);
    assert.strictEqual(s2.pose, "");
  });

  it("relays avatar changes and rejects oversized ones", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c1 = await colyseus.connectTo(room, { avatar: "{}" });
    const c2 = await colyseus.connectTo(room);
    await room.waitForNextPatch();

    c1.send("setAvatar", { avatar: '{"equipped":{"backId":"9"}}' });
    await room.waitForNextPatch();
    assert.strictEqual(c2.state.players.get(c1.sessionId)!.avatar, '{"equipped":{"backId":"9"}}');

    c1.send("setAvatar", { avatar: "x".repeat(3500) });
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(c2.state.players.get(c1.sessionId)!.avatar, '{"equipped":{"backId":"9"}}'); // ignored

    c1.send("setAvatar", { avatar: "" }); // signing out clears it
    await until(() => c2.state.players.get(c1.sessionId)!.avatar === "");
    assert.strictEqual(c2.state.players.get(c1.sessionId)!.avatar, "");
  });

  it("relays the equipped shovel, trail and pets, rejecting unknown ids", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c1 = await colyseus.connectTo(room);
    const c2 = await colyseus.connectTo(room);
    await room.waitForNextPatch();

    c1.send("setShovel", { shovel: "diamond" });
    c1.send("setTrail", { trail: "red" });
    c1.send("setPets", { pets: ["piggy", "bogus", "dragon", "cat", "fox"] });
    await until(() => c2.state.players.get(c1.sessionId)!.pets === "piggy,dragon,cat");
    const s = c2.state.players.get(c1.sessionId)!;
    assert.strictEqual(s.shovel, "diamond");
    assert.strictEqual(s.trail, "red");
    assert.strictEqual(s.pets, "piggy,dragon,cat"); // unknown dropped, capped at 3

    c1.send("setShovel", { shovel: "laser" });
    c1.send("setTrail", { trail: "<script>" });
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(c2.state.players.get(c1.sessionId)!.shovel, "diamond"); // ignored
    assert.strictEqual(c2.state.players.get(c1.sessionId)!.trail, "red"); // ignored

    c1.send("setTrail", { trail: "" });
    await until(() => c2.state.players.get(c1.sessionId)!.trail === "");
    assert.strictEqual(c2.state.players.get(c1.sessionId)!.trail, "");
  });

  it("removes a player who leaves", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c1 = await colyseus.connectTo(room);
    const c2 = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    assert.strictEqual(c2.state.players.size, 2);

    await c1.leave();
    await room.waitForNextPatch();
    assert.strictEqual(c2.state.players.size, 1);
    assert.strictEqual(c2.state.players.has(c1.sessionId), false);
  });

  it("saves a signed-in player's progress", async () => {
    const fake = fakePlayersCollection();
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "u1", username: "Digger" });

    c.send("saveProgress", {
      money: 120, strength: 33, rebirths: 1,
      shovels: ["wooden", "steel"], shovel: "steel", bag: [{ name: "Gem", rarity: "Uncommon", value: 95 }],
      pets: [{ id: 1, pid: "piggy", equipped: true }], nextPetId: 2,
    });
    await until(() => fake.docs.has("u1"));
    const doc = fake.docs.get("u1")!;
    assert.strictEqual(doc.money, 120);
    assert.strictEqual(doc.username, "Digger");
    assert.deepStrictEqual(doc.shovels, ["wooden", "steel"]);
    assert.deepStrictEqual(doc.pets, [{ id: 1, pid: "piggy", equipped: true }]);
    assert.strictEqual(room.state.players.get(c.sessionId)!.rebirths, 1);
    assert.strictEqual(room.state.players.get(c.sessionId)!.strength, 33);
  });

  it("sends a returning account its saved progress, and noProgress to a new one", async () => {
    const fake = fakePlayersCollection([
      { _id: "u2", username: "Back", money: 900, strength: 40, level: 3, shovel: "steel", version: 1, updatedAt: new Date() },
    ]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});

    // The reply can land before a client handler is registered, so capture it server-side.
    const sent: [string, any][] = [];
    const orig = (room as any).loadProgress.bind(room);
    (room as any).loadProgress = (c: any, ...rest: any[]) => {
      const send = c.send.bind(c);
      c.send = (type: string, msg: any) => {
        sent.push([type, msg]);
        send(type, msg);
      };
      return orig(c, ...rest);
    };

    const back = await colyseus.connectTo(room, { userId: "u2", username: "Back" });
    await colyseus.connectTo(room, { userId: "u-new", username: "Fresh" });
    await until(() => sent.length >= 2);

    const progress = sent.find(([t]) => t === "progress")![1];
    assert.strictEqual(progress.money, 900);
    assert.strictEqual(progress.shovel, "steel");
    assert.ok(sent.some(([t]) => t === "noProgress"));

    const p = room.state.players.get(back.sessionId)!;
    assert.strictEqual(p.strength, 40);
    assert.strictEqual(p.level, 3);
  });

  it("tutorial: a legacy save reads as finished, a new account starts at 0, and the step never goes back", async () => {
    const fake = fakePlayersCollection([{ _id: "old", username: "Old", money: 5, version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});

    const sent: [string, any][] = [];
    const orig = (room as any).loadProgress.bind(room);
    (room as any).loadProgress = (c: any, ...rest: any[]) => {
      const send = c.send.bind(c);
      c.send = (type: string, msg: any) => {
        sent.push([type, msg]);
        send(type, msg);
      };
      return orig(c, ...rest);
    };
    await colyseus.connectTo(room, { userId: "old", username: "Old" });
    await until(() => sent.length >= 1);
    assert.strictEqual(sent.find(([t]) => t === "progress")![1].tutorialStep, 11);

    const c = await colyseus.connectTo(room, { userId: "fresh", username: "Fresh" });
    c.send("saveProgress", { money: 1 });
    await until(() => fake.docs.has("fresh"));
    assert.strictEqual(fake.docs.get("fresh")!.tutorialStep, 0);

    c.send("saveProgress", { tutorialStep: 6 });
    await until(() => fake.docs.get("fresh")!.tutorialStep === 6);
    c.send("saveProgress", { tutorialStep: 2, money: 2 });
    await until(() => fake.docs.get("fresh")!.money === 2);
    assert.strictEqual(fake.docs.get("fresh")!.tutorialStep, 6);
  });

  it("accepts a save far larger than Colyseus's default 4 KB message cap", async () => {
    const fake = fakePlayersCollection();
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "big", username: "Hoarder" });
    const found = Array.from({ length: 800 }, (_, i) => `Item number ${i}`);
    c.send("saveProgress", { money: 1, found });
    await until(() => fake.docs.has("big"), 2000);
    assert.strictEqual(fake.docs.get("big")!.found!.length, 800);
  });

  it("never persists guests", async () => {
    const fake = fakePlayersCollection();
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "guest-abc", username: "Guest" });
    c.send("saveProgress", { money: 5, strength: 9 });
    await until(() => room.state.players.get(c.sessionId)?.strength === 9);
    assert.strictEqual(fake.docs.size, 0);
    assert.strictEqual(room.state.players.get(c.sessionId)!.strength, 9); // still on the live board
  });

  it("broadcasts leaderboards merging saved and online players", async () => {
    const fake = fakePlayersCollection([
      { _id: "old", username: "Veteran", strength: 5000, money: 10, rebirths: 4, version: 1, updatedAt: new Date() },
    ]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "u3", username: "Newbie" });
    let boards: any = null;
    c.onMessage("leaderboard", (m) => (boards = m));
    c.send("saveProgress", { strength: 100, rebirths: 1 });
    await until(() => room.state.players.get(c.sessionId)?.strength === 100);
    boards = null;
    await (room as any).refreshLeaderboard();
    await until(() => boards !== null);
    assert.deepStrictEqual(boards.strength.map((r: any) => r.name), ["Veteran", "Newbie"]);
    assert.deepStrictEqual(boards.rebirths.map((r: any) => r.value), [4, 1]);
    assert.ok(boards.money && boards.level);
  });
  const firstItem = (room: any) => {
    let found: [string, any] | null = null;
    room.state.loot.forEach((it: any, id: string) => {
      if (!found) found = [id, it];
    });
    return found!;
  };

  it("fills the lane with loot every player sees", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room);
    await until(() => c.state.loot.size > 100, 2000);
    assert.ok(room.state.loot.size > 100);
    assert.strictEqual(c.state.loot.size, room.state.loot.size);
    const [, it] = firstItem(room);
    assert.ok(it.name && it.value > 0 && it.z < 0);
  });

  it("only lets the first claim win, and only once the item was dug free and is in range", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room);
    const b = await colyseus.connectTo(room);
    const [id, it] = firstItem(room);
    const replies: any[] = [];
    a.onMessage("lootClaim", (m) => replies.push(["a", m]));
    b.onMessage("lootClaim", (m) => replies.push(["b", m]));
    const before = room.state.loot.size;

    a.send("pose", { x: it.x, z: it.z });
    b.send("pose", { x: it.x, z: it.z });
    await until(() => room.state.players.get(b.sessionId)!.z === it.z);

    a.send("claimLoot", { id }); // not dug free yet
    await until(() => replies.length === 1);
    assert.strictEqual(replies[0][1].ok, false);

    a.send("lootFreed", { id });
    await until(() => room.state.loot.get(id)!.expiresAt > 0);
    const expires = room.state.loot.get(id)!.expiresAt;
    b.send("lootFreed", { id }); // a second report never restarts the countdown
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(room.state.loot.get(id)!.expiresAt, expires);

    a.send("claimLoot", { id });
    b.send("claimLoot", { id });
    await until(() => replies.length === 3);
    const results = replies.slice(1).map(([who, m]) => [who, m.ok]);
    assert.deepStrictEqual(results.filter(([, ok]) => ok).length, 1); // exactly one winner
    assert.ok(replies.some(([, m]) => m.ok && m.item.name === it.name));
    assert.strictEqual(room.state.loot.size, before - 1);
    assert.ok(!room.state.loot.has(id));
  });

  it("rejects a claim from out of range", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    const a = await colyseus.connectTo(room);
    const [id, it] = firstItem(room);
    const replies: any[] = [];
    a.onMessage("lootClaim", (m) => replies.push(m));
    a.send("pose", { x: it.x, z: it.z });
    await until(() => room.state.players.get(a.sessionId)!.z === it.z);
    a.send("lootFreed", { id });
    await until(() => room.state.loot.get(id)!.expiresAt > 0);
    a.send("pose", { x: 0, z: 40 }); // back in the plaza
    await until(() => room.state.players.get(a.sessionId)!.z === 40);
    a.send("claimLoot", { id });
    await until(() => replies.length === 1);
    assert.strictEqual(replies[0].ok, false);
    assert.ok(room.state.loot.has(id));
  });

  it("expires dug-free items and respawns claimed or expired ones", async () => {
    const room = await colyseus.createRoom<WorldState>("world", {});
    await colyseus.connectTo(room);
    const world = (room as any).loot;
    const total = room.state.loot.size;
    const now = Date.now();

    const [id, it] = firstItem(room);
    const [idB] = [...(function* () { let n = 0; for (const [k] of (room.state.loot as any).entries()) { if (n++ === 1) yield k; } })()];
    world.free(id, now);
    world.tick(now + 1000); // not expired yet
    assert.ok(room.state.loot.has(id));
    world.tick(now + 151_000); // past LOOT.lifetime
    assert.ok(!room.state.loot.has(id));
    assert.strictEqual(room.state.loot.size, total - 1);
    assert.ok(room.state.loot.has(idB)); // never dug free: stays

    world.tick(now + 151_000 + 120_000); // past the respawn delay
    assert.strictEqual(room.state.loot.size, total);
    assert.ok(!room.state.loot.has(id)); // a fresh id, not the old one
    void it;
  });
});
