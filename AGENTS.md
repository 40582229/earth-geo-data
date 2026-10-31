# AGENTS.md

Rules for anyone — human or agent — changing this repository. They are not
suggestions; code that ignores them will be sent back.

## Naming

**Full names, spelled out.** A name is read far more often than it is typed, so
take the longer one whenever it says more. That includes loop counters and
callbacks: there is no such thing as "it is only a temporary".

| not this | this |
|---|---|
| `i`, `j` | `index`, or `levelIndex` when there is more than one |
| `t` | `fraction`, `snowFraction` |
| `a`, `b` | `lowerAnchor`, `upperAnchor` |
| `at` | `offset`, `writeOffset` |
| `o`, `r`, `y` | `resolved`, `radiusAtHeight`, `heightOffset` |
| `h00`, `h01` | `topLeftHeight`, `topRightHeight` |
| `c0`, `r1` | `columnBefore`, `rowAfter` |
| `lut` | `lookupTable` |
| `spec` | `fieldHeader` |
| `full` | `resolvedView` |

If a name needs a comment to say what it is, the name is wrong.

**camelCase for every identifier that is not a type.** Variables, function
parameters, properties, and module constants — including exported ones:

```ts
export const earthRadiusM = 6371000
const elevationTableSize = 4096
const byId = new Map(...)
```

**PascalCase for classes, interfaces, type aliases and enums** — `EarthGeoData`,
`ElevationGrid`, `GlobeView`, `SurfaceColour`.

**Files and folders are lowercase**, hyphenated when there is more than one
word: `prepare-data.mjs`, `fetch-landcover.py`, `landcover/earth.ts`.

Two things keep their own casing because they belong to someone else: environment
variables (`EARTHGEO_SOURCE`) and format identifiers in strings
(`'earthGeoData/1'`).

What is left short is what the domain already speaks: the coordinates `x`, `y`,
`z`, `lon`, `lat`, and the colour triple `rgb`. Everything else is written out —
`earthRadiusM`, `snowWarmEdgeC`, `columnFraction`, `topRightHeight`.

**Arrow functions, always.** The `function` keyword does not appear in this
repository — not for exports, not for helpers:

```ts
export const loadLandCover = async (
  source = 'landcover-4096',
  options: SourceOptions = {},
): Promise<LandCoverGrid> => landCoverFromData(await openDataset(source, options))

const snowAmount = (latitude: number, metres: number): number => {
  const fraction = (snowWarmEdgeC - annualMeanCelsius(latitude, metres)) / snowBandC
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction
}
```

A `function` declaration hoists, a `const` arrow does not, so **declare helpers
above the code that runs at module load**. The compiler says `TS2448` when you
get it wrong, and a `ReferenceError` if something slips past it.

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

The whole of `src/` currently carries about 180 comment lines in 2,400. Keep it
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

### One folder per file

Every file with code in it — a function, a constant, a class — sits in a folder
named after itself, with its types, its tests and a barrel around it:

```
src/colour/ramp/
  index.ts        the barrel: the only way in
  ramp.ts         the code
  ramp.types.ts   the types it owns
  ramp.test.ts    the checks that fail when it changes
```

- **`ramp.types.ts` holds the file's own exported types** — its interfaces and
  type aliases, and no values at all. A module that declares no types of its own
  has no `.types.ts`: `src/elevation/layout/` is three files, not four, because
  everything `gridLayout` speaks is a type it imports. An empty file is not
  part of the pattern.
- **`ramp.test.ts` sits beside what it tests**, and never reaches `dist/`:
  `tsconfig.json` excludes `*.test.ts`, so a test cannot be published by
  accident.
- **`index.ts` re-exports the module and its types** — `export { ramp } from
  './ramp.js'`, `export type { RampAnchor } from './ramp.types.js'` — so the
  folder presents one edge to the folder above, the way every folder here does.
  Import through it, never through `ramp.ts`.

Two files are not modules and get no folder: `index.ts`, which is the barrel
itself, and a folder-level `types.ts`, which holds the type two or more modules
share — `src/colour/types.ts` keeps `Color3` because both `ramp` and
`landcover` speak it. A type that belongs to one module goes in that module's
`.types.ts` instead.

That is the shape of the tree, and it stays that shape: every module under
`src/` is a folder, `src/source/index.ts` is a barrel and nothing else, and each
check lives in the `.test.ts` of the module it covers. **Nothing new is added
flat.**

## Commands

```bash
npm install          # dev dependencies only; there are no runtime ones
npm run build        # tsc -> dist/, with *.test.ts left out
npm run typecheck    # tsc --noEmit over src/ and the tests beside it
npm test             # builds dist/ and .test-dist/, then 107 checks on the data
npm run prepare-data # fill data/ from a source folder (see below)
```

`npm test` compiles twice: `dist/` without the tests, which is what ships, and
`.test-dist/` with them, which is what runs. `node --test` takes one file at a
time here — almost every test opens the 69 MB grid, and the surface tests hold
half a gigabyte each.

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

Four grids ship, 78 MB, all of them committed: `terrain-4096`, both
`etopo2022-4096` surfaces and `landcover-4096`. The finer Terrarium resolutions
are listed in `.gitignore` and are opt-in:

```bash
EARTHGEO_SOURCE=/path/to/earthGeoData npm run prepare-data -- --all
python3 scripts/fetch-landcover.py                      # rebuild the class grid
```

Without `--all`, `prepare-data` copies only the shipped three and leaves
anything else in `data/` alone, then rewrites `data/index.json` to describe
exactly what is on disk. That file is generated — never hand-edit it.

Anything you add to `data/` by hand is picked up by the next run and described
from its own envelope, which is how `landcover-4096` survived being fetched by a
different script.

## Pull requests

`main` takes changes only through a pull request, so every change starts on a
branch:

```bash
git switch -c what-you-are-doing
git commit -m "…"
git push -u origin what-you-are-doing
gh pr create --fill --draft
```

Open it as a **draft** and leave it a draft. Three clicks belong to the human and
never to you:

- **opening** anything other than a draft — `gh pr create --draft`, every time
- **marking it ready for review** — that click is what runs the review workflow
- **merging** — not the web button, not `gh pr merge`, not a push to `main`

Stop at a pushed branch and a draft pull request, then say what you did and wait.
The human marks it ready, reads the review, and merges it in the browser.

## Before you commit

```bash
npm run typecheck && npm test
```

All 107 checks pass, `data/` holds the four grids and nothing else, and the diff
contains no banner comments.
