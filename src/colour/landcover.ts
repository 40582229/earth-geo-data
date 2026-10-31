import type { Color3 } from './types.js'
import { srgbToLinear } from './ramp.js'

/* ════════════════════════════════════════════════════════════════════════════
   land cover — the colour of a *kind* of ground

   The elevation ramp answers "how high", and that is not enough to paint the
   planet. The Sahara is 300 m and sand; the Amazon is 100 m and jungle. One is
   the largest hot desert on Earth and the other is the largest rainforest, and a
   hypsometric ramp gives both the same green — because a ramp is a *cartographic*
   convention, invented to make contours readable, not a description of what a
   satellite sees.

   So the ground gets a second colour table, indexed by what is growing on it.
   The classes are the IGBP scheme that MODIS MCD12Q1 uses, which is the one
   classification every land-cover product is translated into, so the table
   outlives whichever raster this package happens to ship.

   ── these colours are chosen, not sampled ─────────────────────────────────
   They are *not* the colours of any product's display palette. MODIS paints open
   shrubland cream and urban pure red, because those are colours for reading a
   map. These are colours for looking at a planet:

     - forests are dark and desaturated. From orbit a rainforest is nearly black
       green; the saturated greens of a vegetation index are an artefact of
       stretching a narrow band.
     - deserts are bright. Sand has an albedo near 0.4 against a forest's 0.1, and
       the Sahara is the single brightest large feature on the land.
     - everything is a little grey. Atmosphere between the camera and the ground
       does that, and it is the difference between a globe and a diagram.

   The ocean is not in here at all. Water is a bathymetry problem, the elevation
   ramp already solved it, and two ocean ramps in one package would fight.
   ════════════════════════════════════════════════════════════════════════════ */

/** One land-cover class. `id` is the IGBP code as MODIS stores it. */
export type LandCoverClass = {
  /** The IGBP class code, 1..17. */
  id: number
  /** A stable machine name, so a caller never has to remember that 9 is savanna. */
  key: string
  /** What a person calls it. */
  name: string
  /** sRGB, the numbers you would type into a colour picker. Converted on use. */
  rgb: Color3
}

/** The seventeen IGBP classes, with the colour each one gets on the globe. */
export const LAND_COVER: readonly LandCoverClass[] = [
  { id: 1, key: 'evergreen-needleleaf', name: 'Evergreen needleleaf forest', rgb: [0.078, 0.184, 0.106] },
  { id: 2, key: 'evergreen-broadleaf', name: 'Evergreen broadleaf forest', rgb: [0.047, 0.243, 0.075] },
  { id: 3, key: 'deciduous-needleleaf', name: 'Deciduous needleleaf forest', rgb: [0.157, 0.255, 0.118] },
  { id: 4, key: 'deciduous-broadleaf', name: 'Deciduous broadleaf forest', rgb: [0.176, 0.318, 0.114] },
  { id: 5, key: 'mixed-forest', name: 'Mixed forest', rgb: [0.114, 0.243, 0.114] },
  { id: 6, key: 'closed-shrubland', name: 'Closed shrubland', rgb: [0.302, 0.282, 0.169] },
  { id: 7, key: 'open-shrubland', name: 'Open shrubland', rgb: [0.514, 0.443, 0.278] },
  { id: 8, key: 'woody-savanna', name: 'Woody savanna', rgb: [0.392, 0.4, 0.196] },
  { id: 9, key: 'savanna', name: 'Savanna', rgb: [0.588, 0.533, 0.275] },
  { id: 10, key: 'grassland', name: 'Grassland', rgb: [0.635, 0.592, 0.361] },
  { id: 11, key: 'permanent-wetland', name: 'Permanent wetland', rgb: [0.169, 0.278, 0.227] },
  { id: 12, key: 'cropland', name: 'Cropland', rgb: [0.573, 0.522, 0.302] },
  { id: 13, key: 'urban', name: 'Urban and built-up', rgb: [0.467, 0.455, 0.435] },
  { id: 14, key: 'cropland-mosaic', name: 'Cropland / natural vegetation mosaic', rgb: [0.478, 0.451, 0.271] },
  { id: 15, key: 'snow-ice', name: 'Permanent snow and ice', rgb: [0.945, 0.961, 0.976] },
  { id: 16, key: 'barren', name: 'Barren or sparsely vegetated', rgb: [0.804, 0.698, 0.502] },
  { id: 17, key: 'water', name: 'Water bodies', rgb: [0.078, 0.169, 0.302] },
]

/** The class codes that mean water. IGBP uses 0 and 17 for the same thing, and
 *  some products write 255 for "no data over the sea"; all three are water here. */
export const WATER_CLASSES: readonly number[] = [0, 17]

/** The class code for permanent snow and ice. */
export const SNOW_CLASS = 15

const BY_ID = new Map(LAND_COVER.map((entry) => [entry.id, entry]))

/** One class by code, or undefined for a code this table has never heard of. */
export function landCoverClass(id: number): LandCoverClass | undefined {
  return BY_ID.get(id)
}

/** The colour of a class, in linear light — the space a vertex buffer wants.
 *
 *  Applies the same trick as `elevationColor`: one triple, reused, so a caller
 *  paints eight million vertices without allocating eight million arrays. Copy
 *  the three numbers out before asking for the next one.
 *
 *  An unknown code comes back as water rather than black. A hole in a colour
 *  table should look like a hole in the ocean, not a hole in the render. */
export function landCoverColor(id: number): Color3 {
  const entry = BY_ID.get(id) ?? BY_ID.get(17)!
  scratch[0] = srgbToLinear(entry.rgb[0])
  scratch[1] = srgbToLinear(entry.rgb[1])
  scratch[2] = srgbToLinear(entry.rgb[2])
  return scratch
}
const scratch: [number, number, number] = [0, 0, 0]

/** The name of a class, for a legend or an assertion. */
export function landCoverName(id: number): string {
  return landCoverClass(id)?.name ?? `class ${id}`
}

/** The class whose `key` matches, which is the readable way to say "snow". */
export function landCoverId(key: string): number | undefined {
  return LAND_COVER.find((entry) => entry.key === key)?.id
}
