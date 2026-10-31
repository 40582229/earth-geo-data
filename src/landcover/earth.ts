import type { Color3 } from '../colour/types.js'
import { elevationColor } from '../colour/ramp.js'
import { SNOW_CLASS, WATER_CLASSES, landCoverColor } from '../colour/landcover.js'
import type { ElevationGrid } from '../elevation/grid.js'
import { gridLayout } from '../elevation/layout.js'
import type { SurfaceColour } from '../elevation/surface.js'
import type { LandCoverGrid } from './grid.js'
import { classAt } from './grid.js'

/* ════════════════════════════════════════════════════════════════════════════
   earth — two rasters and a thermometer, which is most of what a planet looks
   like from orbit

   One number decides a vertex's colour, and it is not the height. The colour of
   a patch of ground is roughly "what biome is here, and is it cold enough to be
   white instead". So the rule reads three things and combines them in order of
   how much each one usually decides:

     1. height           is it under water? Then it is ocean, and the elevation
                         ramp already paints bathymetry better than anything
                         here could. This is also the coastline: one cell below
                         sea level and the colour changes source entirely.
     2. land-cover class the biome. Desert, jungle, steppe, ice.
     3. temperature      latitude plus height. Cold enough and even the Sahara
                         would be white; warm enough and even Antarctica would
                         not be, which is why this is a blend and not a test.

   The third one is the reason height still matters on land. Latitude alone puts
   the snow line at sea level near the poles and never at the equator; height
   alone puts it at 4.5 km everywhere. Together they put it in the right place at
   every latitude, from the Alps to the Andes to the Tibetan plateau — and it
   costs one multiply-add per vertex.

   ── what this is and is not ───────────────────────────────────────────────
   It is a *model*, and a model has a tell. Rain shadows are the one it cannot
   do: Lima is a desert at 12°S next to a rainforest at the same latitude, and
   nothing in this file can see the Andes between them. If that matters, the
   answer is a real land-cover raster at higher resolution, not more arithmetic.

   What it buys is that a 4096-wide class grid and a 4096-wide height grid,
   costing 11 MB between them, paint a planet that reads as the Earth from
   space — and that a 1024-wide pair, at a fifth of a megabyte, still reads as
   the Earth.
   ════════════════════════════════════════════════════════════════════════════ */

/** How the land is painted. Everything has a default that looks like the Earth;
 *  the options are there so a caller can paint a different planet with the same
 *  two rasters. */
export type EarthColourOptions = {
  /** Blend land to ice where it is cold enough. Default true. Turn it off and
   *  every mountain is the colour of the ground at sea level beside it. */
  snow?: boolean
  /** Let the snow-and-ice class paint over the ocean, so sea ice and ice shelves
   *  are white instead of water. Default true — without it the Arctic is a hole
   *  in the ice cap, which is not what a satellite sees. */
  ice?: boolean
  /** What to paint below sea level. Default: the elevation ramp, which has the
   *  bathymetry in it. */
  ocean?: (metres: number) => Color3
  /** What to paint a land class. Default: the land-cover palette. */
  land?: (classId: number) => Color3
}

type Resolved = {
  snow: boolean
  ice: boolean
  ocean: (metres: number) => Color3
  land: (classId: number) => Color3
}

const DEFAULTS: Resolved = {
  snow: true,
  ice: true,
  ocean: elevationColor,
  land: landCoverColor,
}

function resolve(options: EarthColourOptions): Resolved {
  if (options.snow === undefined && options.ice === undefined &&
      !options.ocean && !options.land) return DEFAULTS
  return {
    snow: options.snow ?? DEFAULTS.snow,
    ice: options.ice ?? DEFAULTS.ice,
    ocean: options.ocean ?? DEFAULTS.ocean,
    land: options.land ?? DEFAULTS.land,
  }
}

/* ── the thermometer ──────────────────────────────────────────────────────── */

/**
 * Annual mean air temperature at a latitude and a height, in °C.
 *
 * Fitted rather than derived, because the real thing is a climate model. It
 * comes out within a few degrees of the measured annual mean at every band it
 * was checked against, which is all the snow line needs:
 *
 *      lat    here    measured annual mean
 *        0     27.0   ~26      Singapore, Manaus
 *       20     24.3   ~24      the Sahara's northern edge
 *       30     20.9   ~20      Cairo, New Orleans
 *       45     13.2   ~12      Milan, Boston
 *       60      2.5    ~0      southern Siberia, Labrador
 *       70     -6.3   ~-10     the Arctic coast
 *
 * The latitude term is a square, not a line, and that is the whole fit. A
 * linear lapse from 27 °C at the equator comes out 9° too warm at 60°, because
 * the real planet cools faster as ice replaces forest and reflects the sunlight
 * back — a feedback a straight line cannot express.
 *
 * The height term is the standard 6.5 °C per kilometre. It is why the Tibetan
 * plateau is white at 32°N while the Sahara at 25°N is the brightest thing on
 * the land.
 *
 * Check: Everest, 8.85 km at 28°N -> -30.6 °C. The measured summit annual mean
 * is about -19 °C at the rock, colder at the top of the troposphere. Right
 * order, and a snow line does not care about 10°.
 */
export function annualMeanCelsius(latitude: number, metres: number): number {
  return 27 - 0.0068 * latitude * latitude - 0.0065 * metres
}

const SNOW_LINE_C = -9.5

/** The height where the snow blend is half done, at a latitude — the number a
 *  person means by "the snow line". 5,615 m at the equator, 3,500 m at 45°,
 *  1,850 m at 60°, and at sea level at about 73° — which is roughly where the
 *  last glaciers that reach the water are. */
export function snowLineMetres(latitude: number): number {
  return (27 - SNOW_LINE_C - 0.0068 * latitude * latitude) / 0.0065
}

/* ── where the white starts, and why it is not where you would guess ───────
   The first version of this file blended to white from +2 °C down, which is
   where snow *falls*. That painted Siberia white. An annual mean of -5 °C is
   the central Siberian plateau, and it is dark larch forest, because -5 °C a
   year is a hot summer and a savage winter, not permanent ice.

   Permanent snow needs the summer to fail as well, and a single annual mean
   cannot say that. What rescues the model is that at every latitude the answer
   happens to sit at nearly the same annual mean: about -10 °C. Antarctica runs
   -25, the Greenland ice sheet -20, the Arctic Ocean -15, the top of the
   Himalaya -18 — and the Alps at 3,000 m, which have no permanent snow worth
   painting, sit at -8. So one threshold does the job the physics would need
   three numbers for.

   It also stops the model painting the Arctic as ice where the class grid says
   tundra, because tundra tops out around -5. */
const SNOW_WARM_EDGE_C = -5
const SNOW_BAND_C = 9

/** How white a place is, 0..1: none at -5 °C and above, all of it at -14 °C and
 *  below. A band rather than a line because a hard snow line on a smooth 10 km
 *  grid looks like a contour, and snow does not stop at an altitude. */
function snowAmount(latitude: number, metres: number): number {
  const t = (SNOW_WARM_EDGE_C - annualMeanCelsius(latitude, metres)) / SNOW_BAND_C
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/* ── the rule ─────────────────────────────────────────────────────────────── */

// One triple for the blend. `landCoverColor` already reuses its own, so the two
// are copied rather than aliased; nothing here allocates per vertex.
const mixed: [number, number, number] = [0, 0, 0]

function paint(metres: number, classId: number, latitude: number, o: Resolved): Color3 {
  // Ice first, and before the ocean test: an ice shelf is below sea level and
  // still white, and so is the sea ice over the Arctic.
  if (o.ice && classId === SNOW_CLASS) return o.land(SNOW_CLASS)

  // Below sea level the elevation ramp does the work — the shelf, the trenches,
  // the abyssal plains. It is the only thing here that knows how deep it is.
  if (metres <= 0) return o.ocean(metres)

  // Land above the water that the class grid still calls water: a lake, a river
  // wide enough for 500 m pixels. Painted as water, at the palette's one blue.
  if (WATER_CLASSES.includes(classId)) return o.land(17)

  const base = o.land(classId)
  mixed[0] = base[0]
  mixed[1] = base[1]
  mixed[2] = base[2]

  if (o.snow) {
    const white = snowAmount(latitude, metres)
    if (white > 0) {
      const ice = o.land(SNOW_CLASS)
      mixed[0] += (ice[0] - mixed[0]) * white
      mixed[1] += (ice[1] - mixed[1]) * white
      mixed[2] += (ice[2] - mixed[2]) * white
    }
  }

  return mixed
}

/**
 * The colour of a point, given everything that decides it: how high it is, what
 * is on it, and how far from the equator.
 *
 * This is the whole model in one call, with no grid and no surface attached —
 * the version to reach for when the question is "what colour is 51.5°N at 300 m
 * of grassland" rather than "paint eight million vertices".
 *
 *   51.5081, 0, 7      -> the Thames, built-up: grey
 *   -3.4, 60, 100      -> the Amazon: near-black green
 *   23.4, 300, 0       -> the Sahara: sand
 *   27.9, 8849, 28     -> Everest: white
 */
export function earthColour(metres: number, classId: number, latitude: number): Color3 {
  return paint(metres, classId, latitude, DEFAULTS)
}

/**
 * A `colourOf` for `buildSurface`: the rule above, wired to the two grids.
 *
 *   const elevation = await loadElevationGrid('terrain-4096')
 *   const cover     = await loadLandCover()
 *   const surface   = buildSurface(elevation, {
 *     colourOf: earthColours(elevation, cover),
 *   })
 *
 * `grid` supplies the shape — how many rows, and how far apart in latitude —
 * and `cover` supplies the classes. The two do not have to be the same size:
 * every lookup is scaled by the ratio, so an 8192-wide surface samples the
 * 4096-wide classes at every second cell and nobody has to resample a file.
 *
 * The returned function follows the same contract as `elevationColor`: it hands
 * back one reused triple, and `buildSurface` copies the three numbers into the
 * buffer before asking for the next one.
 */
export function earthColours(
  grid: ElevationGrid,
  cover: LandCoverGrid,
  options: EarthColourOptions = {},
): SurfaceColour {
  const o = resolve(options)
  const layout = gridLayout(grid)
  const width = grid.width
  const height = grid.height
  const latitudeSpan = layout.latitudeSpan
  const coverWidth = cover.width
  const coverHeight = cover.height

  /* Column and row are scaled by the ratio of the two grids rather than looked up
     per cell, and the column is taken modulo the surface's own width first: the
     surface writes one extra column past the last meridian to close the seam,
     and that column is column 0's ground, not a ninetieth degree east of it. */
  return (metres: number, row: number, column: number): Color3 => {
    const surfaceColumn = column >= width ? column - width : column
    const coverColumn = Math.min(coverWidth - 1, (surfaceColumn * coverWidth / width) | 0)
    const coverRow = Math.min(coverHeight - 1, (row * coverHeight / height) | 0)
    const latitude = height > 1 ? 90 - (row / (height - 1)) * latitudeSpan : 90

    return paint(metres, classAt(cover, coverColumn, coverRow), latitude, o)
  }
}
