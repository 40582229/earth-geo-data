import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { dataRoot } from '../reader/index.js'
import { datasetEntry, datasetIndex, isPath, listDatasets } from './open.js'

const index = await datasetIndex()

test('four datasets ship', () => {
  assert.equal(index.datasets.length, 4)
})

test('every one is a grid', () => {
  assert.ok(index.datasets.every((entry) => entry.kind === 'grid'))
})

test('one Terrarium grid, both ETOPO surfaces, one class grid', () => {
  assert.equal(
    index.datasets.map((entry) => entry.id).sort().join(','),
    ['etopo2022-bed-4096', 'etopo2022-surface-4096', 'landcover-4096', 'terrain-4096'].join(','),
  )
})

test('exactly one grid is not in metres', () => {
  assert.equal(
    index.datasets.filter((entry) => entry.unit !== 'm').map((entry) => `${entry.id}:${entry.unit}`).join(','),
    'landcover-4096:class',
  )
})

test('an id resolves to its path', async () => {
  assert.equal((await datasetEntry('terrain-4096')).path, 'terrain/terrain-4096.json')
})

test('every dataset the manifest lists is on disk', () => {
  const root = fileURLToPath(dataRoot)
  assert.deepEqual(index.datasets.filter((entry) => !existsSync(root + entry.path)).map((entry) => entry.id), [])
})

test('an id is not a path, and a path is', async () => {
  assert.equal(isPath('terrain-4096'), false)
  assert.equal(isPath('terrain/terrain-4096.json'), true)
  assert.equal((await listDatasets()).length, 4)
})
