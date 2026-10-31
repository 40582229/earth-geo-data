import assert from 'node:assert/strict'
import test from 'node:test'

import type { ElevationGrid } from '../grid/index.js'
import { loadElevationGrid } from '../grid/index.js'
import { gridLayout } from './layout.js'

const grid = await loadElevationGrid('terrain-4096')

test('the shipped grid lays its cells out on an equirectangular grid, north first', () => {
  const header = gridLayout(grid)
  assert.equal(header.layout, 'equirectangular')
  assert.equal(header.rowZero, 'north')
})

test('and the header it hands back is the one the data carries', () => {
  assert.equal(gridLayout(grid), grid.data.grid)
})

/* The two refusals exist so a grid this package cannot draw is not drawn wrong
   instead, and neither is reachable from the shipped data. */
const fakeGrid = (layout: string, rowZero: string): ElevationGrid =>
  ({ data: { id: 'fake-1', grid: { layout, rowZero } } }) as unknown as ElevationGrid

test('a layout that is not equirectangular is refused', () => {
  assert.throws(() => gridLayout(fakeGrid('mercator', 'north')), /mercator/)
})

test('a south-first grid is refused rather than drawn upside down', () => {
  assert.throws(() => gridLayout(fakeGrid('equirectangular', 'south')), /rowZero/)
})
