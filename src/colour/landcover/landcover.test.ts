import assert from 'node:assert/strict'
import test from 'node:test'

import { landCover, landCoverColor } from './landcover.js'

test('seventeen IGBP classes', () => {
  assert.equal(landCover.length, 17)
})

test('numbered 1 to 17', () => {
  assert.ok(landCover.every((entry, index) => entry.id === index + 1))
})

test('every channel is 0..1', () => {
  assert.ok(landCover.every((entry) => entry.rgb.every((channel) => channel >= 0 && channel <= 1)))
})

test('a colour comes back in linear light, not sRGB', () => {
  const snow = [...landCoverColor(15)]
  assert.ok(Math.abs(snow[1] - 0.9135) < 0.002, snow[1].toFixed(4))
})

test('sand is brighter than a rainforest', () => {
  const forest = [...landCoverColor(2)]
  const sand = [...landCoverColor(16)]
  assert.ok(sand[0] > forest[0] * 3, `${sand[0].toFixed(3)} against ${forest[0].toFixed(3)}`)
})

test('and a rainforest is greener than it is red', () => {
  const forest = [...landCoverColor(2)]
  assert.ok(forest[1] > forest[0] * 2, forest.map((channel) => channel.toFixed(3)).join(' '))
})

test('a code the table has never seen comes back as water, not black', () => {
  const unknownColour = [...landCoverColor(99)]
  const waterColour = [...landCoverColor(17)]
  assert.ok(unknownColour.every((channel, index) => channel === waterColour[index]))
})
