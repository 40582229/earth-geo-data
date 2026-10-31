import type { EarthGeoData } from '../dataset/container.js'
import type { GlobeView } from '../projection/projector.js'
import { openDataset } from '../source/index.js'
import type { SourceOptions } from '../source/index.js'

/* ════════════════════════════════════════════════════════════════════════════
   grid — an elevation dataset, decoded to metres

   Seven grids ship with this package and they all decode to the same three
   numbers plus one array:

     terrain-1024 .. terrain-7200   the same planet at five resolutions
     etopo2022-surface-4096         the top of the ice
     etopo2022-bed-4096             the rock underneath it

   A grid is the only shape in the container that has no x and no z in it. It is
   one number per cell — an altitude — and the cell's position is implied by its
   index. Everything that turns those two indices into somewhere is in `surface.ts`
   and `../contours/`, and both read the mapping off the header rather than
   assuming it.
   ════════════════════════════════════════════════════════════════════════════ */

/** A decoded elevation grid, in metres, with the shape of the grid. */
export type ElevationGrid = {
  /** The dataset as it came out of the container: header, licence, stats. */
  data: EarthGeoData
  width: number
  height: number
  /** One height in metres per cell: `heights[row * width + column]`. */
  heights: Float32Array
  /** Set on a surface, which is also a grid. A raw grid has no view — there is
   *  nothing to project until somebody asks for a surface. */
  view?: GlobeView
}

/**
 * Fetch a terrain grid and decode it to metres.
 *
 *   1. `data` is base64, not JSON numbers. `atob()` gives back a *string* of one
 *      character per byte; `charCodeAt()` turns each into 0-255 so a typed array
 *      can hold them.
 *   2. the bytes are 16-bit integers, so they are read as an Int16Array or a
 *      Uint16Array — one element per *two* bytes. That is the same idea as an
 *      attribute's itemSize: the view decides how the bytes are grouped.
 *
 * Both steps live in the container decoder, where every dataset gets them too.
 * What is left here is the part specific to elevation: the scale and offset that
 * turn a stored integer into metres.
 *
 * Allocates the whole grid as Float32Array. A 4096x2048 int16 grid is 16 MB
 * stored and 32 MB decoded; the 7200 grid is 52 MB stored and 104 MB decoded.
 * Prefer `data.at()` when you are sampling rather than meshing.
 */
export async function loadElevationGrid(
  source = 'terrain-1024',
  options: SourceOptions = {},
): Promise<ElevationGrid> {
  return gridFromData(await openDataset(source, options))
}

/** The same, for a dataset you already have. */
export function gridFromData(data: EarthGeoData): ElevationGrid {
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
