import assert from 'node:assert/strict'
import test from 'node:test'

import { samplerFromGrid } from '../../projection/projector/index.js'
import { loadSurface } from './surface.js'

const sphere = await loadSurface('terrain-4096')
const plane = await loadSurface('terrain-4096', { view: { surface: 'plane' } })

test('vertices (one extra column closes the seam)', () => {
  assert.equal(sphere.count, (4096 + 1) * 2048)
})

test('positions', () => {
  assert.equal(sphere.positions.length, sphere.count * 3)
})

test('colours', () => {
  assert.equal(sphere.colors.length, sphere.count * 3)
})

test('triangles', () => {
  assert.equal(sphere.indices.length / 3, 4096 * 2047 * 2)
})

test('info holds what was measured, not a second copy of the surface', () => {
  assert.deepEqual(Object.keys(sphere.info).sort(), [
    'belowSeaLevelShare', 'cellDegrees', 'cellDegreesLat', 'columnZeroLon',
    'highestMetres', 'lowestMetres', 'radiusMax', 'radiusMin', 'triangles',
  ])
})

test('the sphere is the shape it was built as', () => {
  assert.equal(sphere.view.surface, 'sphere')
})

test('degrees per column', () => {
  assert.equal(Number(sphere.info.cellDegrees.toFixed(4)), 0.0879)
})

test('relief is pushed out, and the ocean floor is inside sea level', () => {
  assert.ok(sphere.info.radiusMax > 6 && sphere.info.radiusMin < 6,
    `${sphere.info.radiusMin.toFixed(3)} .. ${sphere.info.radiusMax.toFixed(3)}`)
})

test('every colour channel is 0..1', () => {
  assert.ok(sphere.colors.every((channel) => channel >= 0 && channel <= 1))
})

test('the sampler finds the Himalaya, not the sea', () => {
  const everest = samplerFromGrid(sphere.data)(86.9, 27.98)
  assert.ok(everest > 4000, `${everest.toFixed(0)} m`)
})

test('the same vertex count', () => {
  assert.equal(plane.count, sphere.count)
})

test('the same index count', () => {
  assert.equal(plane.indices.length, sphere.indices.length)
})

test('the plane is the shape it was built as', () => {
  assert.equal(plane.view.surface, 'plane')
})

test('the same index buffer, so one set of triangles serves both', () => {
  let same = true
  for (let index = 0; index < plane.indices.length; index += 997) {
    if (plane.indices[index] !== sphere.indices[index]) { same = false; break }
  }
  assert.ok(same)
})

test('twice as wide as it is deep', () => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let index = 0; index < plane.positions.length; index += 3) {
    const x = plane.positions[index]
    const z = plane.positions[index + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const ratio = (maxX - minX) / (maxZ - minZ)
  assert.ok(Math.abs(ratio - 2) < 1e-6, `${(maxX - minX).toFixed(3)} x ${(maxZ - minZ).toFixed(3)}`)
})

test('east at +x, north at -z', () => {
  let minX = Infinity, minZ = Infinity
  for (let index = 0; index < plane.positions.length; index += 3) {
    if (plane.positions[index] < minX) minX = plane.positions[index]
    if (plane.positions[index + 2] < minZ) minZ = plane.positions[index + 2]
  }
  assert.ok(Math.abs(minX + 6) < 1e-6 && Math.abs(minZ + 3) < 1e-6)
})

test('the ocean floor is below the plane', () => {
  let minY = Infinity
  for (let index = 1; index < plane.positions.length; index += 3) {
    if (plane.positions[index] < minY) minY = plane.positions[index]
  }
  assert.ok(minY < 0, `${minY.toFixed(3)}`)
})

test('no triangle faces away from +y', () => {
  // the buffer stores (first, third, second), so the normal is (third - first) x (second - first)
  let facingUp = 0
  let total = 0
  for (let triangleOffset = 0; triangleOffset < plane.indices.length; triangleOffset += 3 * 613) {
    const firstVertex = plane.indices[triangleOffset] * 3
    const secondVertex = plane.indices[triangleOffset + 1] * 3
    const thirdVertex = plane.indices[triangleOffset + 2] * 3
    const positions = plane.positions
    const edgeOneX = positions[secondVertex] - positions[firstVertex]
    const edgeOneZ = positions[secondVertex + 2] - positions[firstVertex + 2]
    const edgeTwoX = positions[thirdVertex] - positions[firstVertex]
    const edgeTwoZ = positions[thirdVertex + 2] - positions[firstVertex + 2]
    const normalY = edgeOneZ * edgeTwoX - edgeOneX * edgeTwoZ
    total++
    if (normalY > 0) facingUp++
  }
  assert.equal(total - facingUp, 0)
})
