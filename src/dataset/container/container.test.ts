import assert from 'node:assert/strict'
import test from 'node:test'

import { base64ToBytes, formatId } from './container.js'
import type {
  EarthGeoDataIndexEntry,
  FieldHeader,
  GridHeader,
  PartHeader,
  RingHeader,
} from './container.types.js'

/* The headers are built out of shared pieces; the envelope they describe is
   not. These compile only while the pieces still put the same keys on the wire,
   which is what the files in data/ were written with. */
type KeysAre<Shape, Expected extends PropertyKey> =
  [keyof Shape] extends [Expected]
    ? ([Expected] extends [keyof Shape] ? true : false)
    : false

const partKeys: KeysAre<PartHeader, 'name' | 'offset' | 'count' | 'closed'> = true
const ringKeys: KeysAre<RingHeader, 'offset' | 'count' | 'role'> = true
const fieldKeys: KeysAre<
  FieldHeader,
  'name' | 'type' | 'byteOffset' | 'count' | 'scale' | 'offset' | 'unit'
> = true
const gridKeys: KeysAre<
  GridHeader,
  'width' | 'height' | 'layout' | 'rowZero' | 'columnZeroLon'
  | 'longitudeSpan' | 'latitudeSpan' | 'type' | 'scale' | 'offset' | 'unit' | 'nodata'
> = true
const entryKeys: KeysAre<
  EarthGeoDataIndexEntry,
  'id' | 'path' | 'kind' | 'title' | 'topology' | 'width' | 'height' | 'unit'
  | 'records' | 'bytes' | 'sourceBytes' | 'sha256' | 'licence' | 'attribution'
  | 'retrieved' | 'fields' | 'stats' | 'band' | 'magnitudeLimit'
> = true

test('the shared header pieces keep the keys the format has', () => {
  assert.deepEqual([partKeys, ringKeys, fieldKeys, gridKeys, entryKeys], [true, true, true, true, true])
})

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
