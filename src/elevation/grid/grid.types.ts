import type { EarthGeoData, GridShape } from '../../dataset/container/index.js'
import type { GlobeView } from '../../projection/projector/index.js'

/** A decoded elevation grid, in metres, with the shape of the grid. */
export type ElevationGrid = GridShape & {
  data: EarthGeoData
  heights: Float32Array
  view?: GlobeView
}
