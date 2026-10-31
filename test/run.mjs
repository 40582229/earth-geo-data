#!/usr/bin/env node
/* run.mjs — what the package promises, checked against the real data.

   Run with `npm test`, which builds first. Most of these are not "it did not
   throw": they are numbers, checked against an independent implementation, so a
   change to the tracer that alters a single case shows up here. */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  annualMeanCelsius, buildContours, buildSurface, datasetEntry, datasetIndex,
  earthColour, earthColours, earthRadiusM, elevationColor, hypsometricLevels,
  landCover, landCoverColor, landCoverFromData, loadElevationGrid, loadLandCover,
  loadSurface, samplerFromGrid, snowLineMetres,
} from '../dist/index.js'

let passed = 0
const failures = []

const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log(`  ok    ${name}${detail ? `  — ${detail}` : ''}`)
  } else {
    failures.push(`${name}${detail ? `  — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`)
  }
}

const identical = (name, actual, expected) => {
  check(name, actual === expected, `${actual}${actual === expected ? '' : ` (expected ${expected})`}`)
}

const section = (title) => {
  console.log(`\n${title}`)
}

const time = (label, fn) => {
  const started = performance.now()
  const value = fn()
  return [value, performance.now() - started, label]
}

/** Which level a vertex belongs to, found from the level offsets. */
const findLevel = (lines, vertex) => {
  const segment = vertex / 2
  for (let index = lines.levels.length - 1; index >= 0; index--) {
    if (segment >= lines.levels[index].offset) return lines.levels[index].level
  }
  return lines.levels[0].level
}

/* ── is the data here at all? ─────────────────────────────────────────────── */

/* The repository carries four of the nine grids — the ones that fit under
   GitHub's file limit. Everything below reads the other five, so say which are
   missing once, here, instead of dying on whichever one is opened first. */

{
  const index = await datasetIndex()
  const data = fileURLToPath(new URL('../data/', import.meta.url))
  const missing = index.datasets
    .filter((entry) => !existsSync(data + entry.path))
    .map((entry) => entry.id)

  if (missing.length) {
    console.error(`\ndata/ is missing ${missing.join(', ')}\n`)
    process.exit(1)
  }
}

/* ── the manifest ─────────────────────────────────────────────────────────── */

section('the manifest')
{
  const index = await datasetIndex()
  identical('four datasets ship', index.datasets.length, 4)
  check(
    'every one is a grid',
    index.datasets.every((d) => d.kind === 'grid'),
    index.datasets.map((d) => d.id).join(', '),
  )
  check(
    'one Terrarium grid, both ETOPO surfaces, one class grid',
    index.datasets.map((d) => d.id).sort().join(',') === [
      'etopo2022-bed-4096', 'etopo2022-surface-4096', 'landcover-4096', 'terrain-4096',
    ].join(','),
  )
  check(
    'exactly one grid is not in metres',
    index.datasets.filter((d) => d.unit !== 'm').map((d) => `${d.id}:${d.unit}`).join(',')
      === 'landcover-4096:class',
  )

  const entry = await datasetEntry('terrain-4096')
  identical('an id resolves to its path', entry.path, 'terrain/terrain-4096.json')
}

/* ── decoding ─────────────────────────────────────────────────────────────── */

section('decoding')
{
  const grid = await loadElevationGrid('terrain-4096')
  identical('width', grid.width, 4096)
  identical('height', grid.height, 2048)
  identical('one height per cell', grid.heights.length, 4096 * 2048)

  const stats = grid.data.stats
  let lowest = Infinity
  let highest = -Infinity
  for (let index = 0; index < grid.heights.length; index++) {
    const height = grid.heights[index]
    if (height < lowest) lowest = height
    if (height > highest) highest = height
  }
  check(
    'the heights match the converter\'s own min and max',
    lowest === stats.min && highest === stats.max,
    `${stats.min} .. ${stats.max} m`,
  )

  const verified = await loadElevationGrid('terrain-4096', { verify: true })
  identical('the file matches the manifest hash', verified.heights.length, 4096 * 2048)

  let threw = false
  try {
    await loadElevationGrid('ne-110m-land')
  } catch (error) {
    threw = error.message.includes('no dataset')
  }
  check('a dataset that is not here says so', threw)
}

section('a grid becomes a surface')
let sphere = await loadSurface('terrain-4096')
{
  const columns = 4096 + 1
  identical('vertices (one extra column closes the seam)', sphere.count, columns * 2048)
  identical('positions', sphere.positions.length, sphere.count * 3)
  identical('colours', sphere.colors.length, sphere.count * 3)
  identical('triangles', sphere.indices.length / 3, 4096 * 2047 * 2)
  identical('the shape it was built as', sphere.info.surface, 'sphere')
  identical('degrees per column', Number(sphere.info.cellDegrees.toFixed(4)), 0.0879)
  check(
    'relief is pushed out, and the ocean floor is inside sea level',
    sphere.info.radiusMax > 6 && sphere.info.radiusMin < 6,
    `${sphere.info.radiusMin.toFixed(3)} .. ${sphere.info.radiusMax.toFixed(3)}`,
  )
  check(
    'every colour channel is 0..1',
    sphere.colors.every((c) => c >= 0 && c <= 1),
  )
  const sample = samplerFromGrid(sphere.data)
  const everest = sample(86.9, 27.98)
  check('the sampler finds the Himalaya, not the sea', everest > 4000, `${everest.toFixed(0)} m`)
}

section('the same grid, laid out flat')
let plane = await loadSurface('terrain-4096', { view: { surface: 'plane' } })
{
  identical('the same vertex count', plane.count, sphere.count)
  identical('the same index count', plane.indices.length, sphere.indices.length)
  identical('the shape it was built as', plane.info.surface, 'plane')

  let same = true
  for (let index = 0; index < plane.indices.length; index += 997) {
    if (plane.indices[index] !== sphere.indices[index]) { same = false; break }
  }
  check('the same index buffer, so one set of triangles serves both', same)

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity
  for (let index = 0; index < plane.positions.length; index += 3) {
    const x = plane.positions[index]
    const y = plane.positions[index + 1]
    const z = plane.positions[index + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
    if (y < minY) minY = y
  }
  check(
    'twice as wide as it is deep',
    Math.abs((maxX - minX) / (maxZ - minZ) - 2) < 1e-6,
    `${(maxX - minX).toFixed(3)} x ${(maxZ - minZ).toFixed(3)}`,
  )
  check('east at +x, north at -z', Math.abs(minX + 6) < 1e-6 && Math.abs(minZ + 3) < 1e-6)
  check('the ocean floor is below the plane', minY < 0, `${minY.toFixed(3)}`)

  // the buffer stores (first, third, second), so the normal is (third - first) x (second - first)
  let facingUp = 0
  let total = 0
  for (let triangleOffset = 0; triangleOffset < plane.indices.length; triangleOffset += 3 * 613) {
    const firstVertex = plane.indices[triangleOffset] * 3
    const secondVertex = plane.indices[triangleOffset + 1] * 3
    const thirdVertex = plane.indices[triangleOffset + 2] * 3
    const positions = plane.positions
    const edgeOneX = positions[secondVertex] - positions[firstVertex]
    const edgeOneY = positions[secondVertex + 1] - positions[firstVertex + 1]
    const edgeOneZ = positions[secondVertex + 2] - positions[firstVertex + 2]
    const edgeTwoX = positions[thirdVertex] - positions[firstVertex]
    const edgeTwoY = positions[thirdVertex + 1] - positions[firstVertex + 1]
    const edgeTwoZ = positions[thirdVertex + 2] - positions[firstVertex + 2]
    const normalY = edgeOneZ * edgeTwoX - edgeOneX * edgeTwoZ
    total++
    if (normalY > 0) facingUp++
  }
  identical('no triangle faces away from +y', total - facingUp, 0)
}

/* Segment counts from the Python reference implementation (gen-terrain.py's
   marching_squares), run over the same grids at the same sixteen levels. These
   are exact: every one of the sixteen cases, both saddles included, has to
   agree or the number moves. */
const reference = {
  'terrain-4096': {
    total: 293084,
    counts: [22169, 18369, 22523, 35969, 48405, 37837, 5782, 33473, 29087, 18396, 11130, 5710, 1900, 1310, 994, 30],
  },
  'terrain-4096': {
    total: 839308,
    counts: [53377, 43636, 57706, 103798, 151193, 122422, 18848, 91158, 81034, 53050, 32154, 17302, 5756, 4304, 3462, 108],
  },
  'terrain-4096': {
    total: 2197861,
    counts: [121474, 99399, 137138, 264533, 399429, 328782, 51559, 244658, 222819, 147714, 90776, 48646, 16672, 13146, 10774, 342],
  },
}

// each of those was 400 MB; nothing below needs them
sphere = null
plane = null

section('height lines')
{
  const grid = await loadElevationGrid('terrain-4096')
  const [lines, ms] = time('contours', () => buildContours(grid))

  identical('levels traced', lines.levels.length, hypsometricLevels.length)
  identical('total segments', lines.segments, reference['terrain-4096'].total)
  console.log(`        (traced in ${ms.toFixed(0)} ms)`)

  const expected = [...hypsometricLevels].sort((left, right) => left - right)
  let mismatches = 0
  for (let index = 0; index < expected.length; index++) {
    const level = lines.levels[index]
    const want = reference['terrain-4096'].counts[hypsometricLevels.indexOf(expected[index])]
    if (level.level !== expected[index] || level.segments !== want) {
      mismatches++
      console.log(`        level ${expected[index]}: got ${level.segments}, expected ${want}`)
    }
  }
  identical('every level matches the reference, one at a time', mismatches, 0)

  let contiguous = lines.levels[0].offset === 0
  for (let index = 1; index < lines.levels.length; index++) {
    if (lines.levels[index].offset !== lines.levels[index - 1].offset + lines.levels[index - 1].segments) contiguous = false
  }
  check('the levels tile the buffer with no gaps', contiguous)
  identical('two vertices per segment', lines.positions.length, lines.segments * 2 * 3)
}

section('the lines sit on the height they claim')
{
  const grid = await loadElevationGrid('terrain-4096')
  const flat = buildContours(grid, { view: { surface: 'plane' } })
  const perDegree = 6 / 180
  const perMetre = (6 * 30) / earthRadiusM
  const sample = samplerFromGrid(grid.data)

  let worst = 0
  let worstAt = null
  let vertical = 0
  for (let vertex = 0; vertex < flat.positions.length / 3; vertex += 617) {
    const level = findLevel(flat, vertex)
    const x = flat.positions[vertex * 3]
    const y = flat.positions[vertex * 3 + 1]
    const z = flat.positions[vertex * 3 + 2]

    if (Math.abs(y - level * perMetre) > 1e-3) vertical++
    const height = sample(x / perDegree, -z / perDegree)
    const error = Math.abs(height - level)
    if (error > worst) { worst = error; worstAt = { level, x, z } }
  }
  identical('every line is drawn at its own height', vertical, 0)
  check(
    'and tracing back to the grid gives that height again',
    worst < 1,
    `worst ${worst.toFixed(3)} m over ${Math.ceil(flat.positions.length / 3 / 617)} vertices` +
      (worstAt ? ` (at ${worstAt.level} m)` : ''),
  )
}

section('the shape does not change the lines')
{
  const grid = await loadElevationGrid('terrain-4096')
  const round = buildContours(grid)
  const flat = buildContours(grid, { view: { surface: 'plane' } })
  identical('a sphere and a plane trace the same segments', round.segments, flat.segments)
  identical('and agree level for level', round.levels.map((level) => level.segments).join(','), flat.levels.map((level) => level.segments).join(','))

  const radius = 6
  const relief = 30 / earthRadiusM
  let wrongRadius = 0
  for (let vertex = 0; vertex < round.positions.length / 3; vertex += 1013) {
    const level = findLevel(round, vertex)
    const x = round.positions[vertex * 3], y = round.positions[vertex * 3 + 1], z = round.positions[vertex * 3 + 2]
    const distance = Math.hypot(x, y, z)
    if (Math.abs(distance - radius * (1 + level * relief)) > 1e-4) wrongRadius++
  }
  identical('and every globe vertex sits at its own radius', wrongRadius, 0)
}

section('choosing the levels')
{
  const grid = await loadElevationGrid('terrain-4096')

  const one = buildContours(grid, { levels: [1000] })
  identical('one level, one entry', one.levels.length, 1)
  identical('at the height asked for', one.levels[0].level, 1000)

  const hundreds = buildContours(grid, { levels: [500, 1000, 500, 1000] })
  identical('duplicate levels collapse', hundreds.levels.length, 2)
  identical('and come back sorted', hundreds.levels.map((l) => l.level).join(','), '500,1000')

  const every = buildContours(grid, { every: 2000 })
  check(
    'every 2000 m lands on exact multiples',
    every.levels.every((l) => l.level % 2000 === 0),
    every.levels.map((l) => l.level).join(', '),
  )

  const never = buildContours(grid, { levels: [10000] })
  identical('a height nothing reaches has no segments', never.segments, 0)
  identical('but is still in the list', never.levels.length, 1)

  let threw = false
  try { buildContours(grid, { every: 0 }) } catch { threw = true }
  check('every 0 is rejected', threw)
}

section('everything else that ships')
{
  for (const id of ['terrain-4096', 'etopo2022-bed-4096']) {
    const grid = await loadElevationGrid(id)
    identical(
      `${id} decodes to one height per cell`,
      grid.heights.length,
      grid.width * grid.height,
    )
  }

  /* ETOPO is a different source, a different licence and a different encoding
     (int16 against uint16), so if the tracer only worked on Terrarium numbers
     this is where it would show. */
  const etopo = await loadElevationGrid('etopo2022-surface-4096')
  const etopoLines = buildContours(etopo)
  identical('ETOPO surface contour segments', etopoLines.segments, 2136195)

  const surface = await loadSurface('terrain-4096')
  identical(
    'the 4096 grid builds a surface',
    surface.info.triangles,
    4096 * 2047 * 2,
  )
  const fromSurface = buildContours(surface)
  identical(
    'a surface can be handed straight to the tracer',
    fromSurface.segments,
    reference['terrain-4096'].total,
  )
}

section('land cover: a second raster')
{
  const cover = await loadLandCover('landcover-4096')
  identical('width', cover.width, 4096)
  identical('height', cover.height, 2048)
  identical('one class per cell', cover.classes.length, 4096 * 2048)

  const known = new Uint8Array(256)
  for (const entry of landCover) known[entry.id] = 1

  const counts = new Uint32Array(256)
  let unknown = 0
  for (let index = 0; index < cover.classes.length; index++) {
    const id = cover.classes[index]
    counts[id]++
    if (!known[id]) unknown++
  }
  identical('no cell holds a code the palette cannot name', unknown, 0)

  const water = counts[17] / cover.classes.length
  const ice = counts[15] / cover.classes.length
  check('two thirds of it is water', water > 0.66 && water < 0.69, (water * 100).toFixed(1) + '%')
  check('a tenth of it is permanent ice', ice > 0.09 && ice < 0.12, (ice * 100).toFixed(1) + '%')

  let threw = null
  try {
    landCoverFromData((await loadElevationGrid('terrain-4096')).data)
  } catch (error) {
    threw = error.message
  }
  check('a height grid is refused as a class grid', Boolean(threw && threw.includes('"class"')), threw)
}

section('the palette')
{
  identical('seventeen IGBP classes', landCover.length, 17)
  check('numbered 1 to 17', landCover.every((entry, index) => entry.id === index + 1))
  check('every channel is 0..1', landCover.every((entry) => entry.rgb.every((vertex) => vertex >= 0 && vertex <= 1)))

  const snow = [...landCoverColor(15)]
  check(
    'a colour comes back in linear light, not sRGB',
    Math.abs(snow[1] - 0.9135) < 0.002,
    snow[1].toFixed(4),
  )

  const forest = [...landCoverColor(2)]
  const sand = [...landCoverColor(16)]
  check('sand is brighter than a rainforest', sand[0] > forest[0] * 3,
    `${sand[0].toFixed(3)} against ${forest[0].toFixed(3)}`)
  check('and a rainforest is greener than it is red', forest[1] > forest[0] * 2,
    forest.map((channel) => channel.toFixed(3)).join(' '))

  const unknownColour = [...landCoverColor(99)]
  const waterColour = [...landCoverColor(17)]
  check(
    'a code the table has never seen comes back as water, not black',
    unknownColour.every((vertex, index) => vertex === waterColour[index]),
  )
}

section('the thermometer')
{
  const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance
  check('the equator at sea level is tropical', near(annualMeanCelsius(0, 0), 27, 1e-9))
  check('45° at sea level is cool temperate', near(annualMeanCelsius(45, 0), 13.23, 1e-9))
  check('Everest is far below freezing', annualMeanCelsius(28, 8849) < -30,
    `${annualMeanCelsius(28, 8849).toFixed(1)} °C`)
  check('a kilometre up costs 6.5 °C',
    near(annualMeanCelsius(0, 1000) - annualMeanCelsius(0, 0), -6.5, 1e-9))
  check('the snow line is 5,615 m at the equator', near(snowLineMetres(0), 5615, 1),
    `${snowLineMetres(0).toFixed(0)} m`)
  check('1,849 m at 60°', near(snowLineMetres(60), 1849, 1), `${snowLineMetres(60).toFixed(0)} m`)
  check('and reaches sea level near 73°', near(snowLineMetres(73), 0, 60),
    `${snowLineMetres(73).toFixed(0)} m`)
}

section('the planet, painted')
{
  const grid = await loadElevationGrid('terrain-4096')
  const cover = await loadLandCover('landcover-4096')
  const colourOf = earthColours(grid, cover)

  const cell = (latitude, longitude) => {
    const row = Math.round(((90 - latitude) / 180) * (grid.height - 1))
    const column = Math.round(((longitude + 180) / 360) * grid.width) % grid.width
    return { row, column, metres: grid.heights[row * grid.width + column] }
  }
  const colourAt = (latitude, longitude) => {
    const { row, column, metres } = cell(latitude, longitude)
    return [...colourOf(metres, row, column)]
  }

  const sahara = colourAt(23, 10)
  const amazon = colourAt(-3.4, -62)
  const antarctic = colourAt(-83, 0)
  const pacific = colourAt(0, -150)

  check('the Sahara is sand', sahara[0] > 0.4 && sahara[0] > sahara[2] * 1.5,
    sahara.map((channel) => channel.toFixed(2)).join(' '))
  check('the Amazon is dark green', amazon[1] > amazon[0] * 5 && amazon[1] < 0.1,
    amazon.map((channel) => channel.toFixed(3)).join(' '))
  check('Antarctica is white', Math.min(...antarctic) > 0.75,
    antarctic.map((channel) => channel.toFixed(2)).join(' '))
  check('the open ocean is blue and dark', pacific[2] > pacific[0] && pacific[2] < 0.2,
    pacific.map((channel) => channel.toFixed(3)).join(' '))

  /* The whole reason the second raster exists, asserted. A hypsometric ramp puts
     the Sahara and the Amazon at 744 m and 54 m — both green, differing only in
     brightness, because a ramp is a function of height and nothing else. */
  const rampSahara = [...elevationColor(cell(23, 10).metres)]
  const rampAmazon = [...elevationColor(cell(-3.4, -62).metres)]
  check('the elevation ramp makes both of them green',
    rampSahara[1] > rampSahara[0] && rampAmazon[1] > rampAmazon[0],
    `${rampSahara.map((channel) => channel.toFixed(2)).join(' ')} / ${rampAmazon.map((channel) => channel.toFixed(2)).join(' ')}`)
  check('the land cover does not',
    sahara[0] > sahara[1] && amazon[1] > amazon[0],
    `${sahara.map((channel) => channel.toFixed(2)).join(' ')} / ${amazon.map((channel) => channel.toFixed(2)).join(' ')}`)

  /* Registration, with no coastline to compare against: if the class grid were a
     row or a column out of step with the heights, deep ocean would come back as
     land in enormous numbers. Two cells in a hundred thousand disagree, and those
     are the ice shelves. */
  let deepOcean = 0
  let deepNotWater = 0
  for (let row = 0; row < grid.height; row++) {
    const coverRow = Math.min(cover.height - 1, (row * cover.height / grid.height) | 0)
    for (let column = 0; column < grid.width; column++) {
      if (grid.heights[row * grid.width + column] >= -1000) continue
      deepOcean++
      const coverColumn = Math.min(cover.width - 1, (column * cover.width / grid.width) | 0)
      const klass = cover.classes[coverRow * cover.width + coverColumn]
      if (klass !== 17 && klass !== 15) deepNotWater++
    }
  }
  const misfit = (deepNotWater / deepOcean) * 100
  check(
    'the two rasters are registered to each other',
    misfit < 0.01,
    `${misfit.toFixed(3)}% of ${deepOcean.toLocaleString()} deep-ocean cells are land`,
  )
}

section('one surface, another raster')
{
  const grid = await loadElevationGrid('terrain-4096')
  const cover = await loadLandCover('landcover-4096')
  const colourOf = earthColours(grid, cover)

  const surface = buildSurface(grid, { colourOf })
  let outOfRange = 0
  for (let index = 0; index < surface.colors.length; index++) {
    const value = surface.colors[index]
    if (!(value >= 0 && value <= 1)) outOfRange++
  }
  identical('every vertex colour is a real colour', outOfRange, 0)

  /* Both rasters are 4096x2048, so a cell looks up the cell it belongs to. */
  const row = Math.round(((90 - 23) / 180) * (grid.height - 1))
  const column = Math.round(((10 + 180) / 360) * grid.width) % grid.width
  const sandy = [...colourOf(grid.heights[row * grid.width + column], row, column)]
  check('the class grid paints the cell it belongs to', sandy[0] > 0.3,
    sandy.map((channel) => channel.toFixed(2)).join(' '))

  /* And the seam column: buildSurface writes one column past the last meridian,
     and it must sample column 0's ground rather than run off the end. */
  const seam = [...colourOf(grid.heights[row * grid.width], row, grid.width)]
  const first = [...colourOf(grid.heights[row * grid.width], row, 0)]
  check('the seam column is column zero', seam.every((vertex, index) => vertex === first[index]))
}


/* ── the tally ────────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const failure of failures) console.log(`  ${failure}`)
  process.exit(1)
}
