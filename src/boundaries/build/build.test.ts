import assert from 'node:assert/strict'
import test from 'node:test'

import { parseEarthGeoData } from '../../dataset/container/index.js'
import type { EarthGeoDataJson } from '../../dataset/container/index.js'
import { defaultView } from '../../projection/projector/index.js'
import { openDataset } from '../../source/index.js'
import { buildBoundaries } from './build.js'

/* The real file, because its counts are the assertion: 127 polygons, 128 rings,
   5,143 points, and one segment between consecutive points — except where the
   ring repeats a point or jumps the antimeridian. */
const land = await openDataset('ne-110m-land')

/** A payload the container accepts, so a ring can be the four points a square is. */
const polygonJson = (longitudes: number[], latitudes: number[]): EarthGeoDataJson => {
  const count = longitudes.length
  const payload = new Float32Array(count * 2)
  payload.set(longitudes, 0)
  payload.set(latitudes, count)
  return {
    format: 'earthGeoData/1',
    id: 'square',
    kind: 'polygons',
    title: 'a square',
    source: {
      name: 'test',
      url: 'https://example.test',
      licence: 'test',
      attribution: 'test',
      retrieved: '2026-01-01',
    },
    byteLength: payload.byteLength,
    recordCount: count,
    fields: [
      { name: 'lon', type: 'float32', byteOffset: 0, count, scale: 1, offset: 0 },
      { name: 'lat', type: 'float32', byteOffset: count * 4, count, scale: 1, offset: 0 },
    ],
    polygons: [{ name: '', rings: [{ offset: 0, count, role: 'outer' }] }],
    data: Buffer.from(payload.buffer).toString('base64'),
  }
}

const openSquare = parseEarthGeoData(polygonJson([0, 10, 10, 0], [0, 0, 10, 10]))
const closedSquare = parseEarthGeoData(polygonJson([0, 10, 10, 0, 0], [0, 0, 10, 10, 0]))
const pointsDataset = parseEarthGeoData({
  ...polygonJson([0, 10, 10, 0], [0, 0, 10, 10]),
  kind: 'points',
  polygons: [],
})

test('the file is the one these counts came from', () => {
  const rings = land.polygons.flatMap((polygon) => polygon.rings)
  assert.equal(land.polygons.length, 127)
  assert.equal(rings.length, 128)
  assert.equal(rings.filter((ring) => ring.role === 'hole').length, 1)
  assert.equal(land.recordCount, 5143)
})

test('a segment between every pair, less the ten that are not there', () => {
  const lines = buildBoundaries(land)
  assert.equal(lines.segments, 5005)
  assert.equal(lines.positions.length, 30030)
})

test('two vertices per segment', () => {
  const lines = buildBoundaries(land)
  assert.equal(lines.positions.length, lines.segments * 6)
})

test('no segment crosses the antimeridian', () => {
  const lines = buildBoundaries(land, { view: { surface: 'plane' } })
  const perDegree = lines.view.radius / 180
  let widest = 0
  for (let offset = 0; offset < lines.positions.length; offset += 6) {
    const span = Math.abs(lines.positions[offset] - lines.positions[offset + 3])
    if (span > widest) widest = span
  }
  assert.ok(widest <= 180 * perDegree, `a segment spans ${widest / perDegree} degrees of longitude`)
})

test('a plane view keeps every line on the map', () => {
  const lines = buildBoundaries(land, { view: { surface: 'plane' } })
  const { radius } = lines.view
  for (let offset = 0; offset < lines.positions.length; offset += 3) {
    assert.ok(Math.abs(lines.positions[offset]) <= radius + 1e-4, 'x is off the plane')
    assert.ok(Math.abs(lines.positions[offset + 2]) <= radius / 2 + 1e-4, 'z is off the plane')
  }
})

test('an open square ring closes itself: four points, four segments', () => {
  const lines = buildBoundaries(openSquare)
  assert.equal(lines.segments, 4)
  assert.equal(lines.positions.length, 24)
})

test('a ring that repeats its first point gives count - 1 segments, none empty', () => {
  const lines = buildBoundaries(closedSquare)
  assert.equal(lines.segments, 4)
  assert.equal(lines.positions.length, 24)
  const { positions } = lines
  for (let offset = 0; offset < positions.length; offset += 6) {
    assert.ok(
      positions[offset] !== positions[offset + 3]
        || positions[offset + 1] !== positions[offset + 4]
        || positions[offset + 2] !== positions[offset + 5],
      'a zero-length segment survived',
    )
  }
})

test('the default lift is 500 m above the surface', () => {
  const defaulted = buildBoundaries(land)
  const explicit = buildBoundaries(land, { liftM: 500 })
  assert.deepEqual(defaulted.positions, explicit.positions)
})

test('the lift changes the geometry, not the segment count', () => {
  const atSurface = buildBoundaries(land, { liftM: 0 })
  const lifted = buildBoundaries(land, { liftM: 5000 })
  assert.equal(lifted.segments, atSurface.segments)
  assert.notDeepEqual(lifted.positions, atSurface.positions)
  const radiusOf = (positions: Float32Array): number =>
    Math.hypot(positions[0], positions[1], positions[2])
  assert.ok(radiusOf(lifted.positions) > radiusOf(atSurface.positions))
})

test('the view comes back resolved, ready to hand on', () => {
  assert.deepEqual(buildBoundaries(land).view, defaultView)
  assert.equal(buildBoundaries(land, { view: { surface: 'plane' } }).view.surface, 'plane')
})

test('a dataset that is not polygons is refused', () => {
  assert.throws(() => buildBoundaries(pointsDataset), /kind is "points", not polygons/)
})
