# earth-geo-data

Elevation data and land cover, and the loaders that turn them into typed arrays.

A grid becomes a **globe or a flat map**. Its **height lines** come out as
vectors, at whatever heights you ask for. Its ground takes **the colour of
whatever is growing on it** — sand, jungle, ice — instead of the colour of its
height.

No renderer, no dependencies. The output is positions, colours and indices —
the one thing every renderer, engine and native binding can agree on.

```bash
npm install earth-geo-data
```

```js
import { loadSurface, buildContours } from 'earth-geo-data'

const surface = await loadSurface('terrain-4096', { view: { surface: 'plane' } })
const lines   = buildContours(surface, { every: 100 })

geometry.setAttribute('position', new BufferAttribute(surface.positions, 3))
geometry.setAttribute('color',    new BufferAttribute(surface.colors, 3))
geometry.setIndex(surface.indices)

geometry.setAttribute('position', new BufferAttribute(lines.positions, 3))  // LineSegments
```

## What ships

Four grids, 78 MB of JSON, 59 MB of payload.

| id | shape | cell | what it is |
|---|---|---|---|
| `terrain-4096` | 4096×2048 | 0.088° | the planet, one height per cell |
| `etopo2022-surface-4096` | 4096×2048 | 0.088° | the top of the ice |
| `etopo2022-bed-4096` | 4096×2048 | 0.088° | the rock underneath it |
| `landcover-4096` | 4096×2048 | 0.088° | what is growing on it — see below |

All four are registered to each other: same 4096×2048 layout, same cell, same
row zero. Subtract bed from surface and you have ice thickness.

They are in the repository, so cloning is all you need. The finer Terrarium
resolutions exist — 5120, 7200, 10800 — and `npm run prepare-data -- --all`
copies them out of a source folder if you want them locally:

```bash
EARTHGEO_SOURCE=/path/to/earthGeoData npm run prepare-data -- --all
```

They are not shipped: the three together are 260 MB, and `terrain-10800` alone is
past what GitHub will take in a file. `prepare-data` also rebuilds
`data/index.json` from whatever is on disk and hashes it, and `npm test` checks
the two against each other.

## Sphere or flat

One option, and everything follows it:

```js
loadSurface('terrain-4096')                        // a globe, radius 6, relief ×30
loadSurface('terrain-4096', { view: { surface: 'plane' } })
```

The plane is the same grid laid out 2:1 — 12 wide, 6 deep, north at −z, east at
+x, and the height still pushing up. **The index buffer is identical.** The two
shapes differ only in what the projection writes, so a layer built with one view
lands on a surface built with the same view and not otherwise. Pass the same
`view` to both and the coastline stays on its land.

Other knobs: `radius`, `heightExaggeration`, `longitudeOffset`.

## The colour of the ground

By default a surface is coloured by height, which makes a relief map: green
lowlands, white peaks, and a Sahara the same colour as the Amazon. Both are a few
hundred metres above sea level. Height cannot tell them apart, because height is
not what makes them different.

So there is a second raster.

```js
import { buildSurface, loadElevationGrid, loadLandCover, earthColours } from 'earth-geo-data'

const elevation = await loadElevationGrid('terrain-4096')
const cover     = await loadLandCover('landcover-4096')
const surface   = buildSurface(elevation, { colourOf: earthColours(elevation, cover) })
```

Nothing else changes: same positions, same indices, same view. Only the numbers
in the colour buffer are different.

Three things decide a colour, in this order:

1. **Height.** Below sea level it is ocean, and the elevation ramp paints the
   bathymetry — it already knows the shelf from the abyssal plain. That is also
   the coastline: one cell under and the colour changes source entirely.
2. **Land-cover class.** The biome. Seventeen IGBP classes, and a palette chosen
   for looking at a planet rather than reading a map. MODIS paints open shrubland
   cream and cities pure red because those are map colours; a rainforest from
   orbit is nearly black green.
3. **Temperature.** `27 − 0.0068·lat² − 0.0065·h`, in °C. Cold enough and the
   biome blends to ice. Everest comes out at −36 °C, the Sahara at +19.

That square on the latitude is the whole fit. A straight line from 27 °C at the
equator runs 9° warm at 60°, because the real planet cools faster as ice replaces
forest and reflects the sunlight back — a feedback a line cannot express. With
it, the snow line lands at 5,615 m at the equator and 1,849 m at 60°, which is
roughly where it is.

| grid | shape | cell | size |
|---|---|---|---|
| `landcover-4096` | 4096×2048 | 0.088° | 11.2 MB |

Eleven megabytes, against 700 MB for the same thing stored as RGB pixels. A
class code is one byte and the palette is seventeen colours, so the resolution
can stay this low and the planet still reads.

The class grid and the height grid are the same 4096×2048, so a cell looks up
the cell it belongs to. Sampling at another resolution works too: every lookup
scales by the ratio, so the same file can paint a bigger surface later without
being resampled.

What it cannot do is rain shadows: Lima is a desert at 12°S beside a rainforest
at the same latitude, and nothing here can see the Andes between them. That is a
job for a higher-resolution raster, not for more arithmetic.

## Height lines

```js
buildContours(grid)                       // the classic sixteen
buildContours(grid, { every: 100 })       // every 100 metres
buildContours(grid, { levels: [1000] })   // one height
```

Traced by marching squares out of the grid you give it — so they work at any
resolution, at any level, on either shape. `levels` are sorted ascending, and the
buffer is grouped by level, so `levels[i].offset` lets you draw the 1000 m line
differently from the 250 m one without scanning.

| grid | segments | traced in |
|---|---|---|
| `terrain-4096` | 2,197,861 | 376 ms |

The default levels are uneven on purpose: −500, −1000, −2000, −3000, −4000,
−5000, −6000 below sea level, then 250, 500, 1000, 1500, 2000, 3000, 4000, 5000,
6000 on land. Most of the planet is abyssal plain and most of what people look at
is under 2 km, so evenly spaced lines would spend themselves in the wrong places.

## Two entry styles

```js
import { loadSurface, buildContours } from 'earth-geo-data'
```

or, one loader at a time:

```js
import { loadElevationGrid } from 'earth-geo-data/elevation'
import { buildContours }     from 'earth-geo-data/contours'
import { projector }         from 'earth-geo-data/projection'
import { elevationColor }    from 'earth-geo-data/colour'
import { loadLandCover }     from 'earth-geo-data/landcover'
import { parseEarthGeoData } from 'earth-geo-data/dataset'
import { openDataset }       from 'earth-geo-data/source'
```

## Browser

In Node the data is read from the package folder and there is nothing to
configure. A browser cannot read files, so serve the `data/` folder yourself and
say where it is:

```js
const surface = await loadSurface('terrain-4096', { base: '/earth-geo/' })
```

```bash
cp -r node_modules/earth-geo-data/data public/earth-geo
```

Anything you do not want to serve, do not copy.

## The format

Datasets are `earthGeoData/1`: a JSON envelope, a base64 typed array, and a
table saying how to read it. `parseEarthGeoData(json)` gives you back something
with `at()`, `value()` and `gridValues()` — views onto one buffer, not copies.

Anything that is not a grid can still be opened and read; it just has no surface
in it, and the loader says so by name rather than by producing an empty mesh.

## Cost, so it is not a surprise

A surface is three arrays: positions and colours at 3 float32 per vertex, and
indices at 1 uint32 per corner. On the shipped grid that is **400 MB** — 8.4 M
vertices, 16.8 M triangles. Budget for it before you build one.

The data caps the detail: 4096 columns is 0.088° a cell, about 9.8 km at the
equator. Nothing here invents detail below that.

## Licences

- The `terrain-*` grids: Mapzen/Tilezen elevation tiles via the AWS Open Data
  program — **public domain / CC0**. Attribution appreciated, not required.
- The `etopo2022-*` grids: NOAA ETOPO 2022 — **public domain**.
- The `landcover-*` grid: MODIS MCD12Q1 via NASA GIBS — **public domain**.
- This package's code: MIT.

Each dataset carries its own `source` block, and `dataset.credit` prints it as
one line. Three of the four licences in the wider format legally require
attribution, so print it.
