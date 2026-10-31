import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dataRoot, isNode, nodeReader } from './reader.js'

test('this runs in Node, and says so', () => {
  assert.equal(isNode(), true)
})

test('the node reader reads a file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'earth-geo-data-'))
  await writeFile(join(folder, 'index.json'), '{"format":"nothing"}')
  assert.equal(await nodeReader(folder)('index.json'), '{"format":"nothing"}')
})

test('a file that is not there fails instead of returning nothing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'earth-geo-data-'))
  await assert.rejects(nodeReader(folder)('missing.json'), /ENOENT/)
})

test('dataRoot lands on the folder the manifest ships in', async () => {
  const index = JSON.parse(await nodeReader(dataRoot)('index.json')) as { format: string }
  assert.equal(index.format, 'earthGeoData-index/1')
})
