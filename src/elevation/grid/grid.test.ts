import assert from 'node:assert/strict'
import test from 'node:test'

import { loadElevationGrid } from './grid.js'

const grid = await loadElevationGrid('terrain-4096')

test('width', () => {
  assert.equal(grid.width, 4096)
})

test('height', () => {
  assert.equal(grid.height, 2048)
})

test('one height per cell', () => {
  assert.equal(grid.heights.length, 4096 * 2048)
})

test("the heights match the converter's own min and max", () => {
  let lowest = Infinity
  let highest = -Infinity
  for (let index = 0; index < grid.heights.length; index++) {
    const height = grid.heights[index]
    if (height < lowest) lowest = height
    if (height > highest) highest = height
  }
  assert.equal(lowest, grid.data.stats.min)
  assert.equal(highest, grid.data.stats.max)
})

test('the file matches the manifest hash', async () => {
  const verified = await loadElevationGrid('terrain-4096', { verify: true })
  assert.equal(verified.heights.length, 4096 * 2048)
})

test('a dataset that is not here says so', async () => {
  await assert.rejects(loadElevationGrid('ne-110m-land'), /no dataset/)
})

test('terrain-4096 decodes to one height per cell', () => {
  assert.equal(grid.heights.length, grid.width * grid.height)
})

test('etopo2022-bed-4096 decodes to one height per cell', async () => {
  const etopo = await loadElevationGrid('etopo2022-bed-4096')
  assert.equal(etopo.heights.length, etopo.width * etopo.height)
})
