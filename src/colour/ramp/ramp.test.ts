import assert from 'node:assert/strict'
import test from 'node:test'

import { elevationColor, elevationRamp, sampleRamp, srgbToLinear } from './ramp.js'

test('srgbToLinear keeps the ends and darkens the middle', () => {
  assert.equal(srgbToLinear(0), 0)
  assert.equal(srgbToLinear(1), 1)
  assert.ok(Math.abs(srgbToLinear(0.5) - 0.21404) < 1e-4, `${srgbToLinear(0.5)}`)
})

test('the pipeline is blue at the bottom, which is the one thing everyone checks', () => {
  const [red, , blue] = elevationRamp[0].rgb
  assert.ok(blue > red, `${elevationRamp[0].rgb.join(' ')}`)
})

test('the ramp clamps below its lowest anchor instead of wrapping', () => {
  assert.deepEqual(sampleRamp(-99999), elevationRamp[0].rgb)
})

test('and above its highest', () => {
  assert.deepEqual(sampleRamp(99999), elevationRamp[elevationRamp.length - 1].rgb)
})

test('an anchor is its own colour', () => {
  assert.deepEqual(sampleRamp(elevationRamp[7].metres), elevationRamp[7].rgb)
})

test('elevationColor hands back linear light, not sRGB', () => {
  const [, , blue] = elevationColor(-20000)
  assert.ok(Math.abs(blue - srgbToLinear(sampleRamp(-20000)[2])) < 1e-6, `${blue}`)
})
