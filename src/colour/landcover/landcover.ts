import type { Color3 } from '../types.js'
import { srgbToLinear } from '../ramp/index.js'
import type { LandCoverClass } from './landcover.types.js'

/* IGBP class codes, the scheme MODIS MCD12Q1 uses; the colours are chosen for a
   planet seen from orbit, not sampled from the product's own display palette. */

/** The seventeen IGBP classes, with the colour each one gets on the globe. */
export const landCover: readonly LandCoverClass[] = [
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
export const waterClasses: readonly number[] = [0, 17, 255]

/** The class code for permanent snow and ice. */
export const snowClass = 15

const byId = new Map(landCover.map((entry) => [entry.id, entry]))

/** One class by code, or undefined for a code this table has never heard of. */
export const landCoverClass = (id: number): LandCoverClass | undefined => {
  return byId.get(id)
}

/* The colour of a class, in linear light — the space a vertex buffer wants.
   Returns the module's one triple, refilled on the next call: read it, or copy
   it, before calling again. */
export const landCoverColor = (id: number): Color3 => {
  const entry = byId.get(id) ?? byId.get(17)!
  scratch[0] = srgbToLinear(entry.rgb[0])
  scratch[1] = srgbToLinear(entry.rgb[1])
  scratch[2] = srgbToLinear(entry.rgb[2])
  return scratch
}
const scratch: [number, number, number] = [0, 0, 0]

/** The name of a class, for a legend or an assertion. */
export const landCoverName = (id: number): string => {
  return landCoverClass(id)?.name ?? `class ${id}`
}

/** The class whose `key` matches, which is the readable way to say "snow". */
export const landCoverId = (key: string): number | undefined => {
  return landCover.find((entry) => entry.key === key)?.id
}
