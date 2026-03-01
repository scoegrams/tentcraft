# Map definitions

Maps define **player count** (1–4), **starting positions**, and **resource counts** (trash dumps + cafes/stores) per base and in the contested zone.

## Schema

- **playerCount** — `1 | 2 | 3 | 4`. Number of bases on the map.
- **starts** — Array of `{ faction, wx, wz }`. One entry per base; faction is `FAC.SCAV` or `FAC.GILD`. In 1v1 the game spawns the base matching the player faction and the one matching the AI faction.
- **resourcePreset** — Optional. Lets you choose amounts without placing every node by hand:
  - **perBase** — `{ dump, cafe, deptstore }`. How many of each resource type **per starting base**. Placed in a ring around each start.
  - **contested** — `{ dump, cafe, deptstore }`. Nodes placed in the **map center** for both sides to fight over.
  - **amounts** — Optional. `{ dump: 2000, cafe: 1500 }` — resource capacity per node.
- **resources** — Optional. Explicit list `[{ type, wx, wz, amount }, ...]`. If present, this is used instead of generating from `resourcePreset`.

## Example (1v1, 2 dumps + 1 cafe per base, 4 contested dumps)

```js
resourcePreset: {
  perBase:    { dump: 2, cafe: 1 },
  contested:  { dump: 4, cafe: 3 },
  amounts:   { dump: 2000, cafe: 1500 },
},
```

## Example (4-player Kaboom-style)

See `kaboom.js`: 4 starts (one per quadrant), same preset shape so each base gets 2 dumps + 1 cafe and the center has 4 dumps + 4 cafes.
