import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultView, earthRadiusM, flat, projector, toQuaternion } from './projector.js'
import type { GlobeView } from './projector.types.js'

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

/* --- the frame: where a marker has to point ---------------------------- */

const at = (frame: Float32Array, axis: number): number[] => {
  return [frame[axis * 3]!, frame[axis * 3 + 1]!, frame[axis * 3 + 2]!]
}

const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

const cross = (a: number[], b: number[]): number[] => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
]

const frameAt = (longitude: number, latitude: number, view = {} as Partial<GlobeView>): Float32Array => {
  const frame = new Float32Array(9)
  projector(view).frame(frame, 0, longitude, latitude)
  return frame
}

/* q v q⁻¹, the way every engine applies a quaternion. */
const turn = (quaternion: Float32Array, vector: number[]): number[] => {
  const x = quaternion[0]!
  const y = quaternion[1]!
  const z = quaternion[2]!
  const w = quaternion[3]!
  const tx = 2 * (y * vector[2]! - z * vector[1]!)
  const ty = 2 * (z * vector[0]! - x * vector[2]!)
  const tz = 2 * (x * vector[1]! - y * vector[0]!)
  return [
    vector[0]! + w * tx + (y * tz - z * ty),
    vector[1]! + w * ty + (z * tx - x * tz),
    vector[2]! + w * tz + (x * ty - y * tx),
  ]
}

const close = (a: number[], b: number[], message: string): void => {
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(a[axis]! - b[axis]!) < 1e-6, `${message}: ${a.join(',')} against ${b.join(',')}`)
  }
}

test('the up of the frame is the point on the surface, radius divided out', () => {
  const point = new Float32Array(3)
  const project = projector({ longitudeOffset: 12 })
  for (const [longitude, latitude] of [[0, 0], [37, -12], [-170, 64], [91, 0]]) {
    project.write(point, 0, longitude!, latitude!, 2500)
    const radius = Math.hypot(point[0]!, point[1]!, point[2]!)
    const up = at(frameAt(longitude!, latitude!, { longitudeOffset: 12 }), 0)
    close(up, [point[0]! / radius, point[1]! / radius, point[2]! / radius], 'up')
  }
})

test('the three axes are square to each other and one unit long, everywhere', () => {
  for (let latitude = -90; latitude <= 90; latitude += 15) {
    for (let longitude = -180; longitude <= 180; longitude += 30) {
      const frame = frameAt(longitude, latitude)
      const up = at(frame, 0)
      const north = at(frame, 1)
      const east = at(frame, 2)
      for (const [name, axis] of [['up', up], ['north', north], ['east', east]] as const) {
        assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-6, `${name} at ${longitude},${latitude}`)
      }
      assert.ok(Math.abs(dot(up, north)) < 1e-6, `up·north at ${longitude},${latitude}`)
      assert.ok(Math.abs(dot(up, east)) < 1e-6, `up·east at ${longitude},${latitude}`)
      assert.ok(Math.abs(dot(north, east)) < 1e-6, `north·east at ${longitude},${latitude}`)
    }
  }
})

test('the frame is right-handed: east cross north is up', () => {
  for (const [longitude, latitude] of [[0, 0], [60, 30], [-120, -45], [15, 80]]) {
    const frame = frameAt(longitude!, latitude!)
    close(cross(at(frame, 2), at(frame, 1)), at(frame, 0), 'east × north')
  }
})

test('north points the way latitude grows, not the way the radius does', () => {
  const project = projector()
  const low = new Float32Array(3)
  const high = new Float32Array(3)
  project.write(low, 0, 20, 10)
  project.write(high, 0, 20, 10.001)
  const step = [high[0]! - low[0]!, high[1]! - low[1]!, high[2]! - low[2]!]
  const up = at(frameAt(20, 10), 0)
  const radial = dot(step, up)
  const tangent = [step[0]! - radial * up[0]!, step[1]! - radial * up[1]!, step[2]! - radial * up[2]!]
  assert.ok(dot(tangent, at(frameAt(20, 10), 1)) > 0)
})

test('a flat map has the same frame at every degree', () => {
  const frame = frameAt(120, -40, { surface: 'plane' })
  assert.deepEqual(Array.from(frame), [0, 1, 0, 0, 0, -1, 1, 0, 0])
})

test('the poles are a frame too, not a NaN', () => {
  for (const latitude of [90, -90]) {
    const frame = frameAt(0, latitude)
    for (const axis of [0, 1, 2]) {
      const vector = at(frame, axis)
      assert.ok(vector.every(Number.isFinite), `axis ${axis} at ${latitude}`)
      assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-6, `axis ${axis} at ${latitude}`)
    }
  }
})

test('the quaternion turns the asset the way it was built', () => {
  const project = projector()
  const cases = [[0, 0], [37, -12], [-170, 64], [0, 90], [0, -90], [180, 0]]
  for (const [longitude, latitude] of cases) {
    const frame = new Float32Array(9)
    project.frame(frame, 0, longitude!, latitude!)
    const up = at(frame, 0)
    const north = at(frame, 1)
    const east = at(frame, 2)

    const yUp = new Float32Array(4)
    toQuaternion(yUp, 0, frame)
    close(turn(yUp, [0, 1, 0]), up, 'y-up +Y')
    close(turn(yUp, [0, 0, 1]), [-north[0]!, -north[1]!, -north[2]!], 'y-up +Z')
    close(turn(yUp, [1, 0, 0]), east, 'y-up +X')
    assert.ok(Math.abs(Math.hypot(...yUp) - 1) < 1e-6, `unit at ${longitude},${latitude}`)

    const zUp = new Float32Array(4)
    toQuaternion(zUp, 0, frame, 0, 'z-up')
    close(turn(zUp, [0, 0, 1]), up, 'z-up +Z')
    close(turn(zUp, [0, 1, 0]), north, 'z-up +Y')
    close(turn(zUp, [1, 0, 0]), east, 'z-up +X')
  }
})

test('a quaternion and a frame both hand back where they stopped', () => {
  const frame = new Float32Array(18)
  const project = projector()
  assert.equal(project.frame(frame, 0, 0, 0), 9)
  assert.equal(project.frame(frame, 9, 10, 10), 18)
  const quaternion = new Float32Array(8)
  assert.equal(toQuaternion(quaternion, 0, frame), 4)
  assert.equal(toQuaternion(quaternion, 4, frame, 9, 'z-up'), 8)
})

test('a quaternion does not care how big the globe is', () => {
  const small = new Float32Array(4)
  const large = new Float32Array(4)
  toQuaternion(small, 0, frameAt(33, 44, { radius: 1 }))
  toQuaternion(large, 0, frameAt(33, 44, { radius: 1000, heightExaggeration: 1 }))
  for (let axis = 0; axis < 4; axis++) {
    assert.ok(Math.abs(small[axis]! - large[axis]!) < 1e-6)
  }
})
