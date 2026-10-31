import type { EarthGeoData, GridShape } from '../../dataset/container/index.js'

/** A decoded land-cover grid: one class code per cell, in row-major order, row 0
 *  at the north pole — the same layout as every elevation grid here. */
export type LandCoverGrid = GridShape & {
  data: EarthGeoData
  classes: ArrayLike<number>
}
