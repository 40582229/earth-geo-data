import type { EarthGeoData } from '../../dataset/container/index.js'
import type { GlobeView } from '../../projection/projector/index.js'

/** A decoded elevation grid, in metres, with the shape of the grid. */
export type ElevationGrid = {
  data: EarthGeoData
  width: number
  height: number
  heights: Float32Array
  view?: GlobeView
}
