import type { EarthGeoData } from '../../dataset/container/index.js'
import { openDataset } from '../../source/index.js'
import type { SourceOptions } from '../../source/index.js'
import type { ElevationGrid } from './grid.types.js'

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
