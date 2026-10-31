import type { EarthGeoData } from '../dataset/container.js'
import type { GlobeView } from '../projection/projector.js'
import { openDataset } from '../source/index.js'
import type { SourceOptions } from '../source/index.js'

/** A decoded elevation grid, in metres, with the shape of the grid. */
export type ElevationGrid = {
  data: EarthGeoData
  width: number
  height: number
  heights: Float32Array
  view?: GlobeView
}

/* Fetch a terrain grid and decode it to metres. */
export const loadElevationGrid = async (
  source = 'terrain-1024',
  options: SourceOptions = {},
): Promise<ElevationGrid> => {
  return gridFromData(await openDataset(source, options))
}

/** The same, for a dataset you already have. */
export const gridFromData = (data: EarthGeoData): ElevationGrid => {
  if (!data.grid) {
    throw new Error(
      `earthGeoData/${data.id}: kind is "${data.kind}", not a grid — loadElevationGrid needs one`,
    )
  }
  return {
    data,
    width: data.grid.width,
    height: data.grid.height,
    heights: data.gridValues(),
  }
}
