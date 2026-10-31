import type { Color3 } from '../types.js'

/** One land-cover class. `id` is the IGBP code as MODIS stores it. */
export type LandCoverClass = {
  id: number
  key: string
  name: string
  rgb: Color3
}
