# Dig Sand Adventure — server

Colyseus server for the `Dig-sand-adventure` client: progress saving, multiplayer presence
(poses, Bloxity avatars, shovels, trails, equipped pets) and leaderboards. Same stack and Bloxity
Legion deploy flow as `Clean-leaves-for-loot-backend`.

```
npm install
npm start        # tsx watch, ws://localhost:2567 (playground + /monitor in dev), GET /health
npm test         # mocha integration tests with an in-memory fake Mongo collection
npm run build    # -> build/, run with `node build/index.js` (see Dockerfile)
```

Config (all optional locally, see `.env.example`): `MONGODB_URI` (without it nothing persists),
`CLIENT_ORIGIN`, `PORT`.

## Protocol

Room: `world` (`joinOrCreate("world", { userId, username, avatar })`), up to 50 players per room;
extra players get a new room. `userId` is the Bloxity id; ids starting `guest-` are never saved.

| Client → server | Purpose |
| --- | --- |
| `pose` | `x y z yaw speed01 grounded pose` (~15 Hz; `pose` is `"dig"` while digging / training, else `null`) |
| `setAvatar` | Bloxity avatar JSON |
| `setShovel` / `setTrail` | equipped shovel id / trail id (`""` = no trail) |
| `setPets` | `{ pets: [species ids] }`, the equipped pets (max 3) |
| `saveProgress` | the persisted `player` keys, debounced (sanitized, upserted in Mongo) |
| `lootFreed` | `{ id }`: an item was dug free; starts its disappear countdown (once, for everyone) |
| `claimLoot` | `{ id }`: pick an item up; first valid claim wins |
| `identify` | `{ userId, username }` after a sign-in / sign-out; answered with `progress` / `noProgress` |

| Server → client | Purpose |
| --- | --- |
| `progress` | the saved document (hydrates `player`) |
| `noProgress` | new account, guest, or no Mongo — keep the local state (and push it) |
| `serverError` | the saved document could not be read; the client must not overwrite it |
| `lootClaim` | `{ id, ok, item? }` answer to `claimLoot` (to the claimer only) |
| `leaderboard` | `{ strength, rebirths, level, money }`, rows `{ id, name, value }`, top 10 (#1 row also carries `avatar`) |

Persisted keys (`src/sanitize.ts`): `money strength level xp xpNext rebirths sand bag sellLocked found
shovels shovel trails trail upgrades pets nextPetId discovered`. Room state (`WorldState.players`)
syncs pose, shovel, trail, equipped pets, avatar, name and the leaderboard stats
(`strength rebirths level money`).

Shared loot (`src/loot.ts`, tunables in `LOOT` / `LANE` in `src/constants.ts`): the room state's `loot` map holds every item lying in the dig lane. Slots refill with a freshly rolled item `respawnBase + respawnPerZone x band` s after being claimed or expiring; an item expires `lifetime` s after the first `lootFreed`. Claims need the item dug free and the player's last pose within `claimRange`.

The game is client-authoritative: the server only enforces shape and bounds on saves. The id lists
and caps in `src/constants.ts` (`SHOVEL_IDS`, `TRAIL_IDS`, `PET_IDS`, `UPGRADE_MAX`, `RARITIES`,
`SPAWN`, `WORLD_BOUNDS`) must be kept in step with the client's `src/config.js` / `src/data/*.js` by hand.

## Deploy

`.github/workflows/deploy.yml`: pull requests run build + tests; pushes to `dev` deploy the dev
channel and `main` the prod channel on Bloxity Legion (image pushed to GHCR). Needs the repo
variable `LEGION_GAME_ID` (= the client's `GAME_SLUG`, `dig-sand-adventure`) and the secret
`LEGION_DEPLOY_TOKEN`.
