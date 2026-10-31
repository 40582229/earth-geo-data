# AGENTS.md

Rules for anyone — human or agent — changing this repository. They are not
suggestions; code that ignores them will be sent back.

## Naming

**camelCase for every identifier that is not a type.** Variables, function
parameters, properties, and module constants — including exported ones:

```ts
export const earthRadiusM = 6371000
const elevationLutSize = 4096
const byId = new Map(...)
```

**PascalCase for classes, interfaces, type aliases and enums** — `EarthGeoData`,
`ElevationGrid`, `GlobeView`, `SurfaceColour`.

**Files and folders are lowercase**, hyphenated when there is more than one
word: `prepare-data.mjs`, `fetch-landcover.py`, `landcover/earth.ts`.

Two things keep their own casing because they belong to someone else: environment
variables (`EARTHGEO_SOURCE`) and format identifiers in strings
(`'earthGeoData/1'`).

No abbreviations except the ones the domain already speaks: `lon`, `lat`, `xyz`,
`rgb`, `lut`, `m` (metres).

## Comments

Default to **none**. Write one only when the code cannot say it itself:

- a formula, or where the arithmetic came from
- an order that matters (why ice is painted before the ocean)
- a workaround, or a limit imposed by a file format
- a licence or attribution requirement

What not to write:

- banner boxes, ASCII art, `/* ─── section ─── */` dividers
- "what this file is" essays at the top of a file — that belongs in the README
- a comment that restates the line under it
- commented-out code

JSDoc: **one line per exported declaration, at most**. If the type already says
it, say nothing. `/** The width of the grid in cells. */` above `width: number`
is noise.

The whole of `src/` currently carries about 180 comment lines in 2,300. Keep it
that way; a change that doubles it will be sent back.

## Layout

| folder | what lives there |
|---|---|
| `src/dataset/` | the `earthGeoData/1` container: decode, validate, read |
| `src/source/` | getting the bytes — file in Node, `fetch` in a browser |
| `src/projection/` | lon/lat → xyz, the one place that knows where anything is |
| `src/colour/` | the elevation ramp and the land-cover palette |
| `src/elevation/` | a grid becomes a surface (globe or flat map) |
| `src/contours/` | marching squares, height lines out of a grid |
| `src/landcover/` | a class grid, and the temperature blend that paints it |

Each folder has an `index.ts` barrel; import through it, not through the files
behind it. Every folder is also a published subpath — `earth-geo-data/colour`
and so on — so the barrels are public API, not tidiness.

## Commands

```bash
npm install          # dev dependencies only; there are no runtime ones
npm run build        # tsc -> dist/
npm run typecheck    # tsc --noEmit
npm test             # build, then 92 checks against the real data
npm run prepare-data # fill data/ from a source folder (see below)
```

## Constraints

- **No runtime dependencies.** `dependencies` stays empty. Nothing here may
  import three.js, or any renderer — output is typed arrays and nothing else.
- **ESM only.** `"type": "module"`, and relative imports carry the `.js`
  extension (`./grid.js`, not `./grid`).
- **Strict TypeScript**, `target: ES2022`, Node 18 and up. No `any` without a
  reason; no non-null assertions in place of a check.
- **The tests are the spec.** `npm test` checks numbers against an independent
  implementation, not just "it did not throw". If you change the tracer, the
  projection or the palette, a number moving is a decision you have to justify.
- **`data/index.json` is generated.** `scripts/prepare-data.mjs` writes it from
  what is on disk. Never hand-edit it, and never hand-add a dataset to it.

## Data

Nine grids ship in the package, 345 MB. Four are committed — `terrain-4096`,
both `etopo2022-4096` surfaces and `landcover-4096`, 78 MB. The other five are
listed in `.gitignore` and generated:

```bash
EARTHGEO_SOURCE=/path/to/earthGeoData npm run prepare-data   # elevation grids
python3 scripts/fetch-landcover.py                           # land cover (needs Pillow)
```

`test/run.mjs` says which datasets are missing before it runs anything, so a
fresh clone fails with an instruction instead of an `ENOENT`.

## Before you commit

```bash
npm run typecheck && npm test
```

All 92 checks pass, the working tree contains no data files that should have
been generated, and the diff contains no banner comments.
