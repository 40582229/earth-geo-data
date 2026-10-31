import assert from 'node:assert/strict'
import test from 'node:test'

import { loadElevationGrid } from '../../elevation/grid/index.js'
import { loadSurface } from '../../elevation/surface/index.js'
import { earthRadiusM, samplerFromGrid } from '../../projection/projector/index.js'
import { buildContours, hypsometricLevels } from './march.js'

/* Segment counts from the Python reference implementation (gen-terrain.py's
   marching_squares), run over the same grid at the same sixteen levels. These
   are exact: every one of the sixteen cases, both saddles included, has to
   agree or the number moves. */
const reference = {
  total: 2197861,
  counts: [121474, 99399, 137138, 264533, 399429, 328782, 51559, 244658,
    222819, 147714, 90776, 48646, 16672, 13146, 10774, 342],
}

/** Which level a vertex belongs to, found from the level offsets. */
const findLevel = (lines: { levels: { level: number; offset: number }[] }, vertex: number): number => {
  const segment = vertex / 2
  for (let index = lines.levels.length - 1; index >= 0; index--) {
    if (segment >= lines.levels[index].offset) return lines.levels[index].level
  }
  return lines.levels[0].level
}

const grid = await loadElevationGrid('terrain-4096')

test('levels traced', () => {
  assert.equal(buildContours(grid).levels.length, hypsometricLevels.length)
})

test('total segments', () => {
  assert.equal(buildContours(grid).segments, reference.total)
})

test('every level matches the reference, one at a time', () => {
  const lines = buildContours(grid)
  const expected = [...hypsometricLevels].sort((left, right) => left - right)
  const mismatches = []
  for (let index = 0; index < expected.length; index++) {
    const level = lines.levels[index]
    const want = reference.counts[hypsometricLevels.indexOf(expected[index])]
    if (level.level !== expected[index] || level.segments !== want) {
      mismatches.push(`${expected[index]}: got ${level.segments}, expected ${want}`)
    }
  }
  assert.deepEqual(mismatches, [])
})

test('the levels tile the buffer with no gaps', () => {
  const lines = buildContours(grid)
  let contiguous = lines.levels[0].offset === 0
  for (let index = 1; index < lines.levels.length; index++) {
    if (lines.levels[index].offset !== lines.levels[index - 1].offset + lines.levels[index - 1].segments) {
      contiguous = false
    }
  }
  assert.ok(contiguous)
})

test('two vertices per segment', () => {
  const lines = buildContours(grid)
  assert.equal(lines.positions.length, lines.segments * 2 * 3)
})

test('every line is drawn at its own height', () => {
  const flat = buildContours(grid, { view: { surface: 'plane' } })
  const perMetre = (6 * 30) / earthRadiusM
  let vertical = 0
  for (let vertex = 0; vertex < flat.positions.length / 3; vertex += 617) {
    const level = findLevel(flat, vertex)
    if (Math.abs(flat.positions[vertex * 3 + 1] - level * perMetre) > 1e-3) vertical++
  }
  assert.equal(vertical, 0)
})

test('and tracing back to the grid gives that height again', () => {
  const flat = buildContours(grid, { view: { surface: 'plane' } })
  const perDegree = 6 / 180
  const sample = samplerFromGrid(grid.data)
  let worst = 0
  let worstLevel = 0
  for (let vertex = 0; vertex < flat.positions.length / 3; vertex += 617) {
    const level = findLevel(flat, vertex)
    const height = sample(flat.positions[vertex * 3] / perDegree, -flat.positions[vertex * 3 + 2] / perDegree)
    const error = Math.abs(height - level)
    if (error > worst) { worst = error; worstLevel = level }
  }
  assert.ok(worst < 1, `worst ${worst.toFixed(3)} m (at ${worstLevel} m)`)
})

test('a sphere and a plane trace the same segments', () => {
  const round = buildContours(grid)
  const flat = buildContours(grid, { view: { surface: 'plane' } })
  assert.equal(round.segments, flat.segments)
})

test('and agree level for level', () => {
  const round = buildContours(grid)
  const flat = buildContours(grid, { view: { surface: 'plane' } })
  assert.equal(
    round.levels.map((level) => level.segments).join(','),
    flat.levels.map((level) => level.segments).join(','),
  )
})

test('and every globe vertex sits at its own radius', () => {
  const round = buildContours(grid)
  const radius = 6
  const relief = 30 / earthRadiusM
  let wrongRadius = 0
  for (let vertex = 0; vertex < round.positions.length / 3; vertex += 1013) {
    const level = findLevel(round, vertex)
    const distance = Math.hypot(
      round.positions[vertex * 3],
      round.positions[vertex * 3 + 1],
      round.positions[vertex * 3 + 2],
    )
    if (Math.abs(distance - radius * (1 + level * relief)) > 1e-4) wrongRadius++
  }
  assert.equal(wrongRadius, 0)
})

test('one level, one entry', () => {
  assert.equal(buildContours(grid, { levels: [1000] }).levels.length, 1)
})

test('at the height asked for', () => {
  assert.equal(buildContours(grid, { levels: [1000] }).levels[0].level, 1000)
})

test('duplicate levels collapse', () => {
  assert.equal(buildContours(grid, { levels: [500, 1000, 500, 1000] }).levels.length, 2)
})

test('and come back sorted', () => {
  assert.equal(
    buildContours(grid, { levels: [500, 1000, 500, 1000] }).levels.map((level) => level.level).join(','),
    '500,1000',
  )
})

test('every 2000 m lands on exact multiples', () => {
  const every = buildContours(grid, { every: 2000 })
  assert.ok(every.levels.every((level) => level.level % 2000 === 0),
    every.levels.map((level) => level.level).join(', '))
})

test('a height nothing reaches has no segments', () => {
  assert.equal(buildContours(grid, { levels: [10000] }).segments, 0)
})

test('but is still in the list', () => {
  assert.equal(buildContours(grid, { levels: [10000] }).levels.length, 1)
})

test('every 0 is rejected', () => {
  assert.throws(() => buildContours(grid, { every: 0 }))
})

test('ETOPO surface contour segments', async () => {
  const etopo = await loadElevationGrid('etopo2022-surface-4096')
  assert.equal(buildContours(etopo).segments, 2136195)
})

test('a surface can be handed straight to the tracer', async () => {
  const surface = await loadSurface('terrain-4096')
  assert.equal(buildContours(surface).segments, reference.total)
})

test('and the lines carry the view it was built with', async () => {
  const surface = await loadSurface('terrain-4096')
  const lines = buildContours(surface)
  assert.deepEqual(lines.view, surface.view)
  assert.equal(lines.width, surface.width)
  assert.equal(lines.height, surface.height)
})
