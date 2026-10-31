import assert from 'node:assert/strict'
import test from 'node:test'

import { landCover } from '../../colour/landcover/index.js'
import { loadElevationGrid } from '../../elevation/grid/index.js'
import { landCoverFromData, loadLandCover } from './grid.js'

const cover = await loadLandCover('landcover-4096')

test('width', () => {
  assert.equal(cover.width, 4096)
})

test('height', () => {
  assert.equal(cover.height, 2048)
})

test('one class per cell', () => {
  assert.equal(cover.classes.length, 4096 * 2048)
})

test('no cell holds a code the palette cannot name', () => {
  const known = new Uint8Array(256)
  for (const entry of landCover) known[entry.id] = 1
  let unknown = 0
  for (let index = 0; index < cover.classes.length; index++) {
    if (!known[cover.classes[index]]) unknown++
  }
  assert.equal(unknown, 0)
})

const counts = new Uint32Array(256)
for (let index = 0; index < cover.classes.length; index++) counts[cover.classes[index]]++

test('two thirds of it is water', () => {
  const water = counts[17] / cover.classes.length
  assert.ok(water > 0.66 && water < 0.69, `${(water * 100).toFixed(1)}%`)
})

test('a tenth of it is permanent ice', () => {
  const ice = counts[15] / cover.classes.length
  assert.ok(ice > 0.09 && ice < 0.12, `${(ice * 100).toFixed(1)}%`)
})

test('a height grid is refused as a class grid', async () => {
  const heights = await loadElevationGrid('terrain-4096')
  assert.throws(() => landCoverFromData(heights.data), /"class"/)
})
