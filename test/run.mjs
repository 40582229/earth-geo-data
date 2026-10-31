#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   run.mjs — what the package promises, checked against the real data

   Run with `npm test`, which builds first. The point of most of these is not
   "it did not throw": it is that the numbers are the numbers. In particular the
   contour segment counts are checked against an independent implementation —
   the Python marching squares that produced the shipped 838,605-segment layer —
   so a change to the tracer that alters a single case shows up here.
   ════════════════════════════════════════════════════════════════════════════ */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  annualMeanCelsius, buildContours, buildSurface, datasetEntry, datasetIndex,
  earthColour, earthColours, EARTH_RADIUS_M, elevationColor, HYPSOMETRIC_LEVELS,
  LAND_COVER, landCoverColor, landCoverFromData, loadElevationGrid, loadLandCover,
  loadSurface, samplerFromGrid, snowLineMetres,
} from '../dist/index.js'

let passed = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  ok    ${name}${detail ? `  — ${detail}` : ''}`)
  } else {
    failures.push(`${name}${detail ? `  — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`)
  }
}

function identical(name, actual, expected) {
  check(name, actual === expected, `${actual}${actual === expected ? '' : ` (expected ${expected})`}`)
}

function section(title) {
  console.log(`\n${title}`)
}

const time = (label, fn) => {
  const started = performance.now()
  const value = fn()
  return [value, performance.now() - started, label]
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
    console.error(
      `\n${missing.length} of ${index.datasets.length} datasets are not in data/: ` +
      `${missing.join(', ')}\n\n` +
      'These are generated, not committed. Produce them with:\n\n' +
      '  EARTHGEO_SOURCE=/path/to/earthGeoData npm run prepare-data\n\n' +
      'where that folder holds an earthGeoData index.json and the files it lists.\n',
    )
    process.exit(1)
  }
}

/* ── the manifest ─────────────────────────────────────────────────────────── */

section('the manifest')
{
  const index = await datasetIndex()
  identical('nine datasets ship', index.datasets.length, 9)
  check(
    'every one is a grid',
    index.datasets.every((d) => d.kind === 'grid'),
    index.datasets.map((d) => d.id).join(', '),
  )
  check(
    'six Terrarium resolutions, both ETOPO surfaces, one class grid',
    index.datasets.map((d) => d.id).sort().join(',') === [
      'etopo2022-bed-4096', 'etopo2022-surface-4096', 'landcover-4096',
      'terrain-1024', 'terrain-10800', 'terrain-2048', 'terrain-4096',
      'terrain-5120', 'terrain-7200',
    ].join(','),
  )
  check(
    'exactly one grid is not in metres',
    index.datasets.filter((d) => d.unit !== 'm').map((d) => `${d.id}:${d.unit}`).join(',')
      === 'landcover-4096:class',
  )

  const entry = await datasetEntry('terrain-1024')
  identical('an id resolves to its path', entry.path, 'terrain/terrain-1024.json')
}

/* ── decoding ─────────────────────────────────────────────────────────────── */

section('decoding')
{
  const grid = await loadElevationGrid('terrain-1024')
  identical('width', grid.width, 1024)
  identical('height', grid.height, 512)
  identical('one height per cell', grid.heights.length, 1024 * 512)

  const stats = grid.data.stats
  let lowest = Infinity
  let highest = -Infinity
  for (let i = 0; i < grid.heights.length; i++) {
    const h = grid.heights[i]
    if (h < lowest) lowest = h
    if (h > highest) highest = h
  }
  check(
    'the heights match the converter\'s own min and max',
    lowest === stats.min && highest === stats.max,
    `${stats.min} .. ${stats.max} m`,
  )

  const verified = await loadElevationGrid('terrain-1024', { verify: true })
  identical('the file matches the manifest hash', verified.heights.length, 1024 * 512)

  let threw = false
  try {
    await loadElevationGrid('ne-110m-land')
  } catch (error) {
    threw = error.message.includes('no dataset')
  }
  check('a dataset that is not here says so', threw)
}

/* ══════════════════════════════════════════════════════════════════════════
   the surface
   ══════════════════════════════════════════════════════════════════════════ */

section('a grid becomes a surface')
const sphere = await loadSurface('terrain-1024')
{
  const columns = 1024 + 1
  identical('vertices (one extra column closes the seam)', sphere.count, columns * 512)
  identical('positions', sphere.positions.length, sphere.count * 3)
  identical('colours', sphere.colors.length, sphere.count * 3)
  identical('triangles', sphere.indices.length / 3, 1024 * 511 * 2)
  identical('the shape it was built as', sphere.info.surface, 'sphere')
  identical('degrees per column', Number(sphere.info.cellDegrees.toFixed(4)), 0.3516)
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
const plane = await loadSurface('terrain-1024', { view: { surface: 'plane' } })
{
  identical('the same vertex count', plane.count, sphere.count)
  identical('the same index count', plane.indices.length, sphere.indices.length)
  identical('the shape it was built as', plane.info.surface, 'plane')

  let same = true
  for (let i = 0; i < plane.indices.length; i += 997) {
    if (plane.indices[i] !== sphere.indices[i]) { same = false; break }
  }
  check('the same index buffer, so one set of triangles serves both', same)

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity
  for (let i = 0; i < plane.positions.length; i += 3) {
    const x = plane.positions[i], y = plane.positions[i + 1], z = plane.positions[i + 2]
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

  // (a, c, b) is the order in the buffer, so the normal is (c - a) x (b - a)
  let facingUp = 0
  let total = 0
  for (let t = 0; t < plane.indices.length; t += 3 * 613) {
    const a = plane.indices[t] * 3, c = plane.indices[t + 1] * 3, b = plane.indices[t + 2] * 3
    const p = plane.positions
    const ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2]
    const vx = p[b] - p[a], vy = p[b + 1] - p[a + 1], vz = p[b + 2] - p[a + 2]
    const ny = uz * vx - ux * vz
    total++
    if (ny > 0) facingUp++
  }
  identical('no triangle faces away from +y', total - facingUp, 0)
}

/* ══════════════════════════════════════════════════════════════════════════
   the contours
   ══════════════════════════════════════════════════════════════════════════ */

/* Segment counts from the Python reference implementation (gen-terrain.py's
   marching_squares), run over the same grids at the same sixteen levels. These
   are exact: every one of the sixteen cases, both saddles included, has to
   agree or the number moves. */
const REFERENCE = {
  'terrain-1024': {
    total: 293084,
    counts: [22169, 18369, 22523, 35969, 48405, 37837, 5782, 33473, 29087, 18396, 11130, 5710, 1900, 1310, 994, 30],
  },
  'terrain-2048': {
    total: 839308,
    counts: [53377, 43636, 57706, 103798, 151193, 122422, 18848, 91158, 81034, 53050, 32154, 17302, 5756, 4304, 3462, 108],
  },
  'terrain-4096': {
    total: 2197861,
    counts: [121474, 99399, 137138, 264533, 399429, 328782, 51559, 244658, 222819, 147714, 90776, 48646, 16672, 13146, 10774, 342],
  },
}

/** The shipped contour layer, drawn from the same 8192-cell source DEM: 16
 *  levels, 838,605 segments. Not identical to terrain-2048 — that grid is the
 *  same DEM subsampled slightly differently — but within a tenth of a percent,
 *  which is the check that the tracer is looking at the same planet. */
const SHIPPED_LAYER_SEGMENTS = 838605

section('height lines')
{
  const grid = await loadElevationGrid('terrain-2048')
  const [lines, ms] = time('contours', () => buildContours(grid))

  identical('levels traced', lines.levels.length, HYPSOMETRIC_LEVELS.length)
  identical('total segments', lines.segments, REFERENCE['terrain-2048'].total)
  check(
    'the shipped layer agrees to a tenth of a percent',
    Math.abs(lines.segments - SHIPPED_LAYER_SEGMENTS) / SHIPPED_LAYER_SEGMENTS < 0.001,
    `${lines.segments} vs ${SHIPPED_LAYER_SEGMENTS} segments`,
  )
  console.log(`        (traced in ${ms.toFixed(0)} ms)`)

  const expected = [...HYPSOMETRIC_LEVELS].sort((a, b) => a - b)
  let mismatches = 0
  for (let i = 0; i < expected.length; i++) {
    const level = lines.levels[i]
    const want = REFERENCE['terrain-2048'].counts[HYPSOMETRIC_LEVELS.indexOf(expected[i])]
    if (level.level !== expected[i] || level.segments !== want) {
      mismatches++
      console.log(`        level ${expected[i]}: got ${level.segments}, expected ${want}`)
    }
  }
  identical('every level matches the reference, one at a time', mismatches, 0)

  let contiguous = lines.levels[0].offset === 0
  for (let i = 1; i < lines.levels.length; i++) {
    if (lines.levels[i].offset !== lines.levels[i - 1].offset + lines.levels[i - 1].segments) contiguous = false
  }
  check('the levels tile the buffer with no gaps', contiguous)
  identical('two vertices per segment', lines.positions.length, lines.segments * 2 * 3)
}

section('the lines sit on the height they claim')
{
  const grid = await loadElevationGrid('terrain-1024')
  const flat = buildContours(grid, { view: { surface: 'plane' } })
  const perDegree = 6 / 180
  const perMetre = (6 * 30) / EARTH_RADIUS_M
  const sample = samplerFromGrid(grid.data)

  let worst = 0
  let worstAt = null
  let vertical = 0
  for (let v = 0; v < flat.positions.length / 3; v += 617) {
    const level = findLevel(flat, v)
    const x = flat.positions[v * 3]
    const y = flat.positions[v * 3 + 1]
    const z = flat.positions[v * 3 + 2]

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
  const grid = await loadElevationGrid('terrain-1024')
  const round = buildContours(grid)
  const flat = buildContours(grid, { view: { surface: 'plane' } })
  identical('a sphere and a plane trace the same segments', round.segments, flat.segments)
  identical('and agree level for level', round.levels.map((l) => l.segments).join(','), flat.levels.map((l) => l.segments).join(','))

  const radius = 6
  const relief = 30 / EARTH_RADIUS_M
  let off = 0
  for (let v = 0; v < round.positions.length / 3; v += 1013) {
    const level = findLevel(round, v)
    const x = round.positions[v * 3], y = round.positions[v * 3 + 1], z = round.positions[v * 3 + 2]
    const r = Math.hypot(x, y, z)
    if (Math.abs(r - radius * (1 + level * relief)) > 1e-4) off++
  }
  identical('and every globe vertex sits at its own radius', off, 0)
}

section('choosing the levels')
{
  const grid = await loadElevationGrid('terrain-1024')

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

section('the 10800 grid, and why it is data rather than a mesh')
{
  /* 0.0333° a cell instead of 0.05°, fetched from the z6 Terrarium tiles at the
     earthGeoData vertex convention. It ships as a grid only: a surface from it
     would be 2.8 GB of buffers, which is the whole reason it is here as
     something to trace and sample rather than something to draw. */
  const fine = await loadElevationGrid('terrain-10800')
  identical('it decodes to one height per cell', fine.heights.length, 10800 * 5400)
  identical('degrees per column', Number((360 / fine.width).toFixed(4)), 0.0333)

  const coarse = await loadElevationGrid('terrain-7200')
  check(
    'finer sampling resolves a higher summit',
    fine.data.stats.max > coarse.data.stats.max,
    `${coarse.data.stats.max} m at 7200 -> ${fine.data.stats.max} m at 10800`,
  )
  check(
    'and a deeper trench',
    fine.data.stats.min < coarse.data.stats.min,
    `${coarse.data.stats.min} m -> ${fine.data.stats.min} m`,
  )

  /* What finer sampling actually buys, measured on the one mountain everyone
     knows the answer for. The summit is 8,849 m at 86.925E 27.988N, and it gets
     closer with every step — but never arrives, because the summit is smaller
     than a cell however fine the grid is. */
  const everest = { lon: 86.925, lat: 27.9881, true: 8849 }
  const trend = []
  for (const id of ['terrain-1024', 'terrain-4096', 'terrain-7200', 'terrain-10800']) {
    const grid = await loadElevationGrid(id)
    trend.push({
      id,
      cell: 360 / grid.width,
      at: samplerFromGrid(grid.data)(everest.lon, everest.lat),
      max: grid.data.stats.max,
    })
  }

  let rising = true
  for (let i = 1; i < trend.length; i++) {
    if (trend[i].at <= trend[i - 1].at) rising = false
  }
  check(
    'every step finer samples Everest higher',
    rising,
    trend.map((t) => `${t.id.replace('terrain-', '')}: ${t.at.toFixed(0)} m`).join('  '),
  )
  check(
    'and the 10800 peak is the one that should be there',
    Math.abs(trend[3].max - 7992) < 1 && trend[3].max > trend[2].max,
    `${trend[2].max} m -> ${trend[3].max} m, at the summit's own cell`,
  )
  check(
    'but even 3.7 km cells stop ~850 m short of the real summit',
    trend[3].max < everest.true && everest.true - trend[3].max > 500,
    `${trend[3].max} m of ${everest.true} m — the summit is smaller than a cell`,
  )
}

section('everything else that ships')
{
  for (const id of ['terrain-4096', 'terrain-5120', 'terrain-7200', 'etopo2022-bed-4096']) {
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
    'the biggest grid this package can still mesh builds',
    surface.info.triangles,
    4096 * 2047 * 2,
  )
  const fromSurface = buildContours(surface)
  identical(
    'a surface can be handed straight to the tracer',
    fromSurface.segments,
    REFERENCE['terrain-4096'].total,
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   the ground, not the height
   ══════════════════════════════════════════════════════════════════════════ */

section('land cover: a second raster')
{
  const cover = await loadLandCover('landcover-4096')
  identical('width', cover.width, 4096)
  identical('height', cover.height, 2048)
  identical('one class per cell', cover.classes.length, 4096 * 2048)

  const known = new Uint8Array(256)
  for (const entry of LAND_COVER) known[entry.id] = 1

  const counts = new Uint32Array(256)
  let unknown = 0
  for (let i = 0; i < cover.classes.length; i++) {
    const id = cover.classes[i]
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
    landCoverFromData((await loadElevationGrid('terrain-1024')).data)
  } catch (error) {
    threw = error.message
  }
  check('a height grid is refused as a class grid', Boolean(threw && threw.includes('"class"')), threw)
}

section('the palette')
{
  identical('seventeen IGBP classes', LAND_COVER.length, 17)
  check('numbered 1 to 17', LAND_COVER.every((entry, i) => entry.id === i + 1))
  check('every channel is 0..1', LAND_COVER.every((entry) => entry.rgb.every((v) => v >= 0 && v <= 1)))

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
    forest.map((v) => v.toFixed(3)).join(' '))

  const unknownColour = [...landCoverColor(99)]
  const waterColour = [...landCoverColor(17)]
  check(
    'a code the table has never seen comes back as water, not black',
    unknownColour.every((v, i) => v === waterColour[i]),
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
    sahara.map((v) => v.toFixed(2)).join(' '))
  check('the Amazon is dark green', amazon[1] > amazon[0] * 5 && amazon[1] < 0.1,
    amazon.map((v) => v.toFixed(3)).join(' '))
  check('Antarctica is white', Math.min(...antarctic) > 0.75,
    antarctic.map((v) => v.toFixed(2)).join(' '))
  check('the open ocean is blue and dark', pacific[2] > pacific[0] && pacific[2] < 0.2,
    pacific.map((v) => v.toFixed(3)).join(' '))

  /* The whole reason the second raster exists, asserted. A hypsometric ramp puts
     the Sahara and the Amazon at 744 m and 54 m — both green, differing only in
     brightness, because a ramp is a function of height and nothing else. */
  const rampSahara = [...elevationColor(cell(23, 10).metres)]
  const rampAmazon = [...elevationColor(cell(-3.4, -62).metres)]
  check('the elevation ramp makes both of them green',
    rampSahara[1] > rampSahara[0] && rampAmazon[1] > rampAmazon[0],
    `${rampSahara.map((v) => v.toFixed(2)).join(' ')} / ${rampAmazon.map((v) => v.toFixed(2)).join(' ')}`)
  check('the land cover does not',
    sahara[0] > sahara[1] && amazon[1] > amazon[0],
    `${sahara.map((v) => v.toFixed(2)).join(' ')} / ${amazon.map((v) => v.toFixed(2)).join(' ')}`)

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
  const small = await loadElevationGrid('terrain-1024')
  const cover = await loadLandCover('landcover-4096')
  const colourOf = earthColours(small, cover)

  const surface = buildSurface(small, { colourOf })
  let outOfRange = 0
  for (let i = 0; i < surface.colors.length; i++) {
    const value = surface.colors[i]
    if (!(value >= 0 && value <= 1)) outOfRange++
  }
  identical('every vertex colour is a real colour', outOfRange, 0)

  /* A 4096-wide class grid painting a 1024-wide surface: the lookup is scaled by
     the ratio, so this has to land on the Sahara's sand just the same. */
  const row = Math.round(((90 - 23) / 180) * (small.height - 1))
  const column = Math.round(((10 + 180) / 360) * small.width) % small.width
  const sandy = [...colourOf(small.heights[row * small.width + column], row, column)]
  check('a 4096-wide class grid paints a 1024-wide surface', sandy[0] > 0.3,
    sandy.map((v) => v.toFixed(2)).join(' '))

  /* And the seam column: buildSurface writes one column past the last meridian,
     and it must sample column 0's ground rather than run off the end. */
  const seam = [...colourOf(small.heights[row * small.width], row, small.width)]
  const first = [...colourOf(small.heights[row * small.width], row, 0)]
  check('the seam column is column zero', seam.every((v, i) => v === first[i]))
}

/** Which level a vertex belongs to, found from the level offsets. */
function findLevel(lines, vertex) {
  const segment = vertex / 2
  for (let i = lines.levels.length - 1; i >= 0; i--) {
    if (segment >= lines.levels[i].offset) return lines.levels[i].level
  }
  return lines.levels[0].level
}

/* ── the tally ────────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const failure of failures) console.log(`  ${failure}`)
  process.exit(1)
}
