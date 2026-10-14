import assert from "assert";

import { sanitizeProgress, resolveTutorialStep } from "../src/sanitize.js";

describe("sanitizeProgress", () => {
  it("rejects non-objects and bounds numbers", () => {
    assert.strictEqual(sanitizeProgress(null), null);
    assert.strictEqual(sanitizeProgress([1]), null);
    const out = sanitizeProgress({ money: 1e30, strength: -5, sand: NaN, level: 0, rebirths: 2.9, hack: "x" })!;
    assert.strictEqual(out.money, 1e18);
    assert.strictEqual(out.strength, 0);
    assert.strictEqual(out.sand, undefined);
    assert.strictEqual(out.level, 1);
    assert.strictEqual(out.rebirths, 2);
    assert.ok(!("hack" in out));
  });

  it("keeps well-formed loot, ids and upgrades and drops the rest", () => {
    const out = sanitizeProgress({
      bag: [{ name: "Gem", rarity: "Uncommon", value: 5 }, { name: "Fake", rarity: "Nope", value: 1 }],
      sellLocked: ["Gem", "Gem", 5],
      found: ["Rock", "Coal", ""],
      shovels: ["wooden", "steel", "bogus", "steel"],
      shovel: "steel",
      trails: ["sand", "nope"],
      trail: null,
      upgrades: { range: 3.7, capacity: 99, bogus: 4, mobility: -2 },
    })!;
    assert.deepStrictEqual(out.bag, [{ name: "Gem", rarity: "Uncommon", value: 5 }]);
    assert.deepStrictEqual(out.sellLocked, ["Gem"]);
    assert.deepStrictEqual(out.found, ["Rock", "Coal"]);
    assert.deepStrictEqual(out.shovels, ["wooden", "steel"]);
    assert.strictEqual(out.shovel, "steel");
    assert.deepStrictEqual(out.trails, ["sand"]);
    assert.strictEqual(out.trail, null);
    assert.deepStrictEqual(out.upgrades, { range: 3, capacity: 17, mobility: 0 });
  });

  it("ignores unknown shovel and trail ids", () => {
    const out = sanitizeProgress({ shovel: "laser", trail: "../etc" })!;
    assert.ok(!("shovel" in out));
    assert.ok(!("trail" in out));
  });

  it("sanitises pets: known species, unique ids, at most 3 equipped", () => {
    const out = sanitizeProgress({
      pets: [
        { id: 1, pid: "piggy", equipped: true },
        { id: 1, pid: "cat", equipped: true }, // duplicate instance id
        { id: 2, pid: "dragon", equipped: true },
        { id: 3, pid: "bogus", equipped: true },
        { id: 4, pid: "fox", equipped: true },
        { id: 5, pid: "cat", equipped: true }, // 4th equipped -> stored unequipped
        "junk",
      ],
      nextPetId: 6.9,
      discovered: ["piggy", "x"],
    })!;
    assert.deepStrictEqual(
      out.pets!.map((p) => [p.id, p.pid, p.equipped]),
      [[1, "piggy", true], [2, "dragon", true], [4, "fox", true], [5, "cat", false]],
    );
    assert.strictEqual(out.nextPetId, 6);
    assert.deepStrictEqual(out.discovered, ["piggy"]);
  });

  it("sanitises daily rewards and boosts", () => {
    const out = sanitizeProgress({
      daily: { day: 9, week: 0, last: "2026-10-14" },
      boosts: { strength: { mult: 4, until: 123 }, cash: { mult: "x", until: 1 }, bogus: { mult: 2, until: 1 } },
    })!;
    assert.deepStrictEqual(out.daily, { day: 6, week: 1, last: "2026-10-14" });
    assert.deepStrictEqual(out.boosts, { strength: { mult: 4, until: 123 } });
    assert.ok(!("daily" in sanitizeProgress({ daily: { day: "a" } })!));
    assert.strictEqual(sanitizeProgress({ daily: { day: 1, week: 1, last: "<script>" } })!.daily!.last, "");
  });
});

describe("tutorial step", () => {
  it("is clamped to the finished step and a missing one reads as finished", () => {
    assert.strictEqual(sanitizeProgress({ tutorialStep: 99 })!.tutorialStep, 11);
    assert.strictEqual(sanitizeProgress({ tutorialStep: -3 })!.tutorialStep, 0);
    assert.strictEqual(sanitizeProgress({ tutorialStep: "x" })!.tutorialStep, undefined);
    assert.strictEqual(resolveTutorialStep({}), 11);
    assert.strictEqual(resolveTutorialStep({ tutorialStep: 4 }), 4);
  });
});
