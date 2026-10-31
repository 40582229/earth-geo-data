import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultView, earthRadiusM, flat, projector } from './projector.js'

test('the radius the relief is measured against is the one everybody quotes', () => {
  assert.equal(earthRadiusM, 6371000)
})

test('the default view is the globe, radius 6, relief at 30x', () => {
  assert.deepEqual(defaultView, {
    radius: 6,
    heightExaggeration: 30,
    longitudeOffset: -45,
    surface: 'sphere',
  })
})

test('the north pole lands on +y, at the radius', () => {
  const point = new Float32Array(3)
  const radiusAtPole = projector({ longitudeOffset: 0 }).write(point, 0, 0, 90, 0)
  assert.ok(Math.abs(point[0]) < 1e-6)
  assert.ok(Math.abs(point[1] - 6) < 1e-6)
  assert.ok(Math.abs(point[2]) < 1e-6)
  assert.ok(Math.abs(radiusAtPole - 6) < 1e-6)
})

test('east is -z, so the globe is not mirrored', () => {
  const point = new Float32Array(3)
  projector({ longitudeOffset: 0 }).write(point, 0, 90, 0, 0)
  assert.ok(Math.abs(point[2] + 6) < 1e-6, `${point[2]}`)
})

test('a metre raises the surface by the exaggeration, not by a metre', () => {
  const shallow = projector().radius(1000) - projector().radius(0)
  assert.ok(Math.abs(shallow - (6 * 1000 * 30) / earthRadiusM) < 1e-9)
})

test('spin turns the globe by the view offset and leaves a plane alone', () => {
  assert.equal(projector({ longitudeOffset: -45 }).spin(10), -35)
  assert.equal(projector({ surface: 'plane' }).spin(10), 10)
})

test('the flat sampler is zero everywhere', () => {
  assert.equal(flat(12, -40), 0)
})
