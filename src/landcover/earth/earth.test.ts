import assert from 'node:assert/strict'
import test from 'node:test'

import { elevationColor } from '../../colour/ramp/index.js'
import { loadElevationGrid } from '../../elevation/grid/index.js'
import { buildSurface } from '../../elevation/surface/index.js'
import { loadLandCover } from '../grid/index.js'
import { annualMeanCelsius, earthColour, earthColours, snowLineMetres } from './earth.js'

const near = (actual: number, expected: number, tolerance: number): boolean =>
  Math.abs(actual - expected) <= tolerance

test('the equator at sea level is tropical', () => {
  assert.ok(near(annualMeanCelsius(0, 0), 27, 1e-9))
})

test('45° at sea level is cool temperate', () => {
  assert.ok(near(annualMeanCelsius(45, 0), 13.23, 1e-9))
})

test('Everest is far below freezing', () => {
  assert.ok(annualMeanCelsius(28, 8849) < -30, `${annualMeanCelsius(28, 8849).toFixed(1)} °C`)
})

test('a kilometre up costs 6.5 °C', () => {
  assert.ok(near(annualMeanCelsius(0, 1000) - annualMeanCelsius(0, 0), -6.5, 1e-9))
})

test('the snow line is 5,615 m at the equator', () => {
  assert.ok(near(snowLineMetres(0), 5615, 1), `${snowLineMetres(0).toFixed(0)} m`)
})

test('1,849 m at 60°', () => {
  assert.ok(near(snowLineMetres(60), 1849, 1), `${snowLineMetres(60).toFixed(0)} m`)
})

test('and reaches sea level near 73°', () => {
  assert.ok(near(snowLineMetres(73), 0, 60), `${snowLineMetres(73).toFixed(0)} m`)
})

/* 255 is what some products write instead of a class over the sea. It has to
   take the water branch: the snow blend is the one place where being merely
   unclassified would show, because class 255 falls back to the water colour
   anyway and only the blend tells the two paths apart. */
test('a 255 cell is water, so snow cannot paint it white', () => {
  assert.deepEqual([...earthColour(3000, 255, 70)], [...earthColour(3000, 17, 70)])
})

/* `paint` refills one triple instead of allocating per vertex, which is right
   for the per-vertex path and wrong for this one: a caller that keeps the
   colour must not have it changed by the next call. */
test('a colour held across the next call does not change', () => {
  const held = earthColour(744, 13, 23)
  const before = [...held]
  earthColour(3000, 16, 60)
  assert.deepEqual([...held], before, 'earthColour handed out the triple it refills')
})

const grid = await loadElevationGrid('terrain-4096')
const cover = await loadLandCover('landcover-4096')
const colourOf = earthColours(grid, cover)

const cell = (latitude: number, longitude: number) => {
  const row = Math.round(((90 - latitude) / 180) * (grid.height - 1))
  const column = Math.round(((longitude + 180) / 360) * grid.width) % grid.width
  return { row, column, metres: grid.heights[row * grid.width + column] }
}
const colourAt = (latitude: number, longitude: number): number[] => {
  const { row, column, metres } = cell(latitude, longitude)
  return [...colourOf(metres, row, column)]
}

const sahara = colourAt(23, 10)
const amazon = colourAt(-3.4, -62)
const antarctic = colourAt(-83, 0)
const pacific = colourAt(0, -150)

test('the Sahara is sand', () => {
  assert.ok(sahara[0] > 0.4 && sahara[0] > sahara[2] * 1.5, sahara.map((c) => c.toFixed(2)).join(' '))
})

test('the Amazon is dark green', () => {
  assert.ok(amazon[1] > amazon[0] * 5 && amazon[1] < 0.1, amazon.map((c) => c.toFixed(3)).join(' '))
})

test('Antarctica is white', () => {
  assert.ok(Math.min(...antarctic) > 0.75, antarctic.map((c) => c.toFixed(2)).join(' '))
})

test('the open ocean is blue and dark', () => {
  assert.ok(pacific[2] > pacific[0] && pacific[2] < 0.2, pacific.map((c) => c.toFixed(3)).join(' '))
})

/* The whole reason the second raster exists, asserted. A hypsometric ramp puts
   the Sahara and the Amazon at 744 m and 54 m — both green, differing only in
   brightness, because a ramp is a function of height and nothing else. */
test('the elevation ramp makes both of them green', () => {
  const rampSahara = [...elevationColor(cell(23, 10).metres)]
  const rampAmazon = [...elevationColor(cell(-3.4, -62).metres)]
  assert.ok(rampSahara[1] > rampSahara[0] && rampAmazon[1] > rampAmazon[0],
    `${rampSahara.map((c) => c.toFixed(2)).join(' ')} / ${rampAmazon.map((c) => c.toFixed(2)).join(' ')}`)
})

test('the land cover does not', () => {
  assert.ok(sahara[0] > sahara[1] && amazon[1] > amazon[0],
    `${sahara.map((c) => c.toFixed(2)).join(' ')} / ${amazon.map((c) => c.toFixed(2)).join(' ')}`)
})

/* Registration, with no coastline to compare against: if the class grid were a
   row or a column out of step with the heights, deep ocean would come back as
   land in enormous numbers. Two cells in a hundred thousand disagree, and those
   are the ice shelves. */
test('the two rasters are registered to each other', () => {
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
  assert.ok(misfit < 0.01, `${misfit.toFixed(3)}% of ${deepOcean.toLocaleString()} deep-ocean cells are land`)
})

test('every vertex colour of a painted surface is a real colour', () => {
  const surface = buildSurface(grid, { colourOf })
  let outOfRange = 0
  for (let index = 0; index < surface.colors.length; index++) {
    const value = surface.colors[index]
    if (!(value >= 0 && value <= 1)) outOfRange++
  }
  assert.equal(outOfRange, 0)
})

test('the class grid paints the cell it belongs to', () => {
  const row = Math.round(((90 - 23) / 180) * (grid.height - 1))
  const column = Math.round(((10 + 180) / 360) * grid.width) % grid.width
  const sandy = [...colourOf(grid.heights[row * grid.width + column], row, column)]
  assert.ok(sandy[0] > 0.3, sandy.map((c) => c.toFixed(2)).join(' '))
})

/* And the seam column: buildSurface writes one column past the last meridian,
   and it must sample column 0's ground rather than run off the end. */
test('the seam column is column zero', () => {
  const row = Math.round(((90 - 23) / 180) * (grid.height - 1))
  const seam = [...colourOf(grid.heights[row * grid.width], row, grid.width)]
  const first = [...colourOf(grid.heights[row * grid.width], row, 0)]
  assert.ok(seam.every((channel, index) => channel === first[index]))
})
