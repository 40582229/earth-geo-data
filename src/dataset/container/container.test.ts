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
   not. Each line below compares a whole shape — keys, value types, and whether
   a key may be absent — against a literal written from the format, so a field
   that quietly changes type fails here rather than in the file it was read
   from. `Flatten` walks the composition away first, one level of array
   included: `Equal` compares a composed type against its own expansion and
   says false, which is a property of the trick and not of the shape. */
type Flatten<Shape> =
  Shape extends readonly (infer Item)[] ? Flatten<Item>[]
    : Shape extends object ? { [Key in keyof Shape]: Flatten<Shape[Key]> }
      : Shape
type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false
type Expect<Value extends true> = Value

type WireFieldType =
  | 'int8' | 'uint8'
  | 'int16' | 'uint16'
  | 'int32' | 'uint32'
  | 'float32' | 'float64'

type WirePart = {
  name: string
  offset: number
  count: number
  closed?: boolean
}

type WireRing = {
  offset: number
  count: number
  role: 'outer' | 'hole'
}

type WireField = {
  type: WireFieldType
  scale: number
  offset: number
  name: string
  byteOffset: number
  count: number
  unit?: string
}

type WireGrid = {
  width: number
  height: number
  type: WireFieldType
  scale: number
  offset: number
  layout: 'equirectangular'
  rowZero: 'north'
  columnZeroLon: number
  longitudeSpan: number
  latitudeSpan: number
  unit: string
  nodata: number | null
}

type WireEntry = {
  id: string
  path: string
  kind: 'grid' | 'points' | 'lines' | 'polygons'
  title: string
  topology?: 'polyline' | 'segments'
  width?: number
  height?: number
  unit?: string
  records?: number
  bytes: number
  sourceBytes: number
  sha256: string
  fields?: { name: string; type: WireFieldType; unit: string | null }[]
  stats?: Record<string, number>
  band?: string
  magnitudeLimit?: number
  licence: string
  attribution: string
  retrieved: string
}

const partWire: Expect<Equal<Flatten<PartHeader>, WirePart>> = true
const ringWire: Expect<Equal<Flatten<RingHeader>, WireRing>> = true
const fieldWire: Expect<Equal<Flatten<FieldHeader>, WireField>> = true
const gridWire: Expect<Equal<Flatten<GridHeader>, WireGrid>> = true
const entryWire: Expect<Equal<Flatten<EarthGeoDataIndexEntry>, WireEntry>> = true

test('the shared header pieces keep the shape the format has', () => {
  assert.deepEqual([partWire, ringWire, fieldWire, gridWire, entryWire], [true, true, true, true, true])
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
