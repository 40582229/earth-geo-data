import type { EarthGeoData } from '../dataset/container.js'
import { openDataset } from '../source/index.js'
import type { SourceOptions } from '../source/index.js'

/** A decoded land-cover grid: one class code per cell, in row-major order, row 0
 *  at the north pole — the same layout as every elevation grid here. */
export type LandCoverGrid = {
  data: EarthGeoData
  width: number
  height: number
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
