import type { GridHeader } from '../dataset/container.js'
import type { ElevationGrid } from './grid.js'

/* ════════════════════════════════════════════════════════════════════════════
   layout — the grid's own description of where its cells are

   There are two ways to turn a cell into an angle: read the header, or assume
   what the header says. The second one is right until a file disagrees, and then
   it is silently wrong in a way that still looks like a planet. So: read it, and
   throw if it describes a layout this package has never been taught.

   Shared, because the surface builder and the contour tracer must agree about
   where a cell is to the last decimal — a contour half a cell off its terrain is
   the same class of bug as a coastline half a degree off its land.
   ════════════════════════════════════════════════════════════════════════════ */

export function gridLayout(grid: ElevationGrid): GridHeader {
  const header = grid.data.grid
  if (!header) {
    throw new Error(
      `earthGeoData/${grid.data.id}: no grid header, so there is nowhere to put the cells`,
    )
  }
  if (header.layout !== 'equirectangular') {
    throw new Error(
      `earthGeoData/${grid.data.id}: layout is "${header.layout}"; this package ` +
      'only knows "equirectangular" — the one where longitude is a column and latitude is a row',
    )
  }
  if (header.rowZero !== 'north') {
    throw new Error(
      `earthGeoData/${grid.data.id}: rowZero is "${header.rowZero}"; this package draws row 0 ` +
      'at the north pole. A south-first grid would come out upside down, so it stops here.',
    )
  }
  return header
}
