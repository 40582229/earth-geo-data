import type { GridHeader } from '../dataset/container.js'
import type { ElevationGrid } from './grid.js'

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
