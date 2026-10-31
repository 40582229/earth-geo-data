import type { EarthGeoData } from '../dataset/container.js'
import { openDataset } from '../source/index.js'
import type { SourceOptions } from '../source/index.js'

/* ════════════════════════════════════════════════════════════════════════════
   a class grid — the second raster

   Elevation cannot say what is growing on the ground. A class grid can, and it
   is the same shape of thing: one number per cell, a rectangle of them, laid out
   the same way. The difference is what the number means — a class code instead
   of a height — and the format already carries that in `grid.unit`.

   So this is not a second decoder. It is the same grid, read for a different
   reason, with the classes kept as the bytes they were shipped as:

     elevation       int16, scale 1, offset -12000   -> metres
     land cover      uint8, scale 1, offset 0        -> a code, 1..17

   `gridRaw()` gives the shipped bytes as a view, so the 8.4 million classes of
   landcover-4096 cost 8.4 MB, not the 34 MB a Float32 copy would. Nothing here
   needs a float: a class is a name, and the name is looked up in the palette.
   ════════════════════════════════════════════════════════════════════════════ */

/** A decoded land-cover grid: one class code per cell, in row-major order, row 0
 *  at the north pole — the same layout as every elevation grid here. */
export type LandCoverGrid = {
  data: EarthGeoData
  width: number
  height: number
  /** The class codes as stored. A view over the dataset's own bytes, not a copy. */
  classes: ArrayLike<number>
}

/** The class code at a cell. Out-of-range cells throw rather than wrap: a colour
 *  read one row off is a coastline in the wrong place, which is exactly the kind
 *  of bug this package exists to make impossible. */
export function classAt(grid: LandCoverGrid, column: number, row: number): number {
  if (column < 0 || column >= grid.width || row < 0 || row >= grid.height) {
    throw new Error(
      `earthGeoData/${grid.data.id}: cell (${column}, ${row}) is outside the ` +
      `${grid.width}x${grid.height} land-cover grid`,
    )
  }
  return grid.classes[row * grid.width + column]
}

/** Wrap a land-cover dataset you already have. */
export function landCoverFromData(data: EarthGeoData): LandCoverGrid {
  const header = data.grid
  if (!header) {
    throw new Error(
      `earthGeoData/${data.id}: kind is "${data.kind}", not a grid — ` +
      'loadLandCover needs one',
    )
  }
  if (header.unit !== 'class') {
    throw new Error(
      `earthGeoData/${data.id}: grid.unit is "${header.unit}", not "class" — ` +
      'this is a height grid, and its numbers would come out as colours',
    )
  }
  return {
    data,
    width: header.width,
    height: header.height,
    classes: data.gridRaw(),
  }
}

/** Fetch a land-cover grid and hand back the classes, with no decode step:
 *  unlike elevation there is no scale and no offset to undo. */
export async function loadLandCover(
  source = 'landcover-4096',
  options: SourceOptions = {},
): Promise<LandCoverGrid> {
  return landCoverFromData(await openDataset(source, options))
}
