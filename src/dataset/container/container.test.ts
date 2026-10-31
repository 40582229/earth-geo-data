import assert from 'node:assert/strict'
import test from 'node:test'

import { base64ToBytes, formatId } from './container.js'

test('the format id is the one the envelopes carry', () => {
  assert.equal(formatId, 'earthGeoData/1')
})

test('base64 survives the round trip', () => {
  const bytes = new Uint8Array([0, 1, 2, 17, 253, 254, 255])
  const decoded = base64ToBytes(Buffer.from(bytes).toString('base64'), bytes.length)
  assert.deepEqual([...decoded], [...bytes])
})

test('a payload shorter than the header claims is refused, not half-filled', () => {
  assert.throws(() => base64ToBytes(Buffer.from([1, 2, 3]).toString('base64'), 4), /the header says 4/)
})
