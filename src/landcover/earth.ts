import type { Color3 } from '../colour/types.js'
import { elevationColor } from '../colour/ramp.js'
import { snowClass, waterClasses, landCoverColor } from '../colour/landcover.js'
import type { ElevationGrid } from '../elevation/grid.js'
import { gridLayout } from '../elevation/layout.js'
import type { SurfaceColour } from '../elevation/surface.js'
import type { LandCoverGrid } from './grid.js'
import { classAt } from './grid.js'

/* Paint order, and why height still matters on land:

     1. ice class        white, where the class grid says permanent ice
     2. below sea level  the elevation ramp: bathymetry, and the coastline
     3. land             the land-cover palette, blended to snow by temperature

   Temperature is latitude plus height, which puts the snow line at sea level in
   the Arctic and at 4.5 km at the equator. */

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

const defaults: Resolved = {
  snow: true,
  ice: true,
  ocean: elevationColor,
  land: landCoverColor,
}

function resolve(options: EarthColourOptions): Resolved {
  if (options.snow === undefined && options.ice === undefined &&
      !options.ocean && !options.land) return defaults
  return {
    snow: options.snow ?? defaults.snow,
    ice: options.ice ?? defaults.ice,
    ocean: options.ocean ?? defaults.ocean,
    land: options.land ?? defaults.land,
  }
}

/* Annual mean air temperature at a latitude and a height, in °C. */
export function annualMeanCelsius(latitude: number, metres: number): number {
  return 27 - 0.0068 * latitude * latitude - 0.0065 * metres
}

const snowLineC = -9.5

/** The height where the snow blend is half done, at a latitude — the number a
 *  person means by "the snow line". 5,615 m at the equator, 3,500 m at 45°,
 *  1,850 m at 60°, and at sea level at about 73° — which is roughly where the
 *  last glaciers that reach the water are. */
export function snowLineMetres(latitude: number): number {
  return (27 - snowLineC - 0.0068 * latitude * latitude) / 0.0065
}

const snowWarmEdgeC = -5
const snowBandC = 9

/** How white a place is, 0..1: none at -5 °C and above, all of it at -14 °C and
 *  below. A band rather than a line because a hard snow line on a smooth 10 km
 *  grid looks like a contour, and snow does not stop at an altitude. */
function snowAmount(latitude: number, metres: number): number {
  const snowFraction = (snowWarmEdgeC - annualMeanCelsius(latitude, metres)) / snowBandC
  return snowFraction < 0 ? 0 : snowFraction > 1 ? 1 : snowFraction
}

// One triple for the blend. `landCoverColor` already reuses its own, so the two
// are copied rather than aliased; nothing here allocates per vertex.
const mixed: [number, number, number] = [0, 0, 0]

function paint(metres: number, classId: number, latitude: number, resolved: Resolved): Color3 {
  // Ice first, and before the ocean test: an ice shelf is below sea level and
  // still white, and so is the sea ice over the Arctic.
  if (resolved.ice && classId === snowClass) return resolved.land(snowClass)

  // Below sea level the elevation ramp does the work — the shelf, the trenches,
  // the abyssal plains. It is the only thing here that knows how deep it is.
  if (metres <= 0) return resolved.ocean(metres)

  // Land above the water that the class grid still calls water: a lake, a river
  // wide enough for 500 m pixels. Painted as water, at the palette's one blue.
  if (waterClasses.includes(classId)) return resolved.land(17)

  const base = resolved.land(classId)
  mixed[0] = base[0]
  mixed[1] = base[1]
  mixed[2] = base[2]

  if (resolved.snow) {
    const white = snowAmount(latitude, metres)
    if (white > 0) {
      const ice = resolved.land(snowClass)
      mixed[0] += (ice[0] - mixed[0]) * white
      mixed[1] += (ice[1] - mixed[1]) * white
      mixed[2] += (ice[2] - mixed[2]) * white
    }
  }

  return mixed
}

/* The colour of a point, given everything that decides it: how high it is, what is on it, and how far from… */
export function earthColour(metres: number, classId: number, latitude: number): Color3 {
  return paint(metres, classId, latitude, defaults)
}

/* A `colourOf` for `buildSurface`: the rule above, wired to the two grids. */
export function earthColours(
  grid: ElevationGrid,
  cover: LandCoverGrid,
  options: EarthColourOptions = {},
): SurfaceColour {
  const resolved = resolve(options)
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

    return paint(metres, classAt(cover, coverColumn, coverRow), latitude, resolved)
  }
}
