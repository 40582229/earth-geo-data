import { defaultView, projector } from '../../projection/projector/index.js'
import type { ElevationGrid } from '../../elevation/grid/index.js'
import { gridLayout } from '../../elevation/layout/index.js'
import type { ContourLevel, ContourLines, ContourOptions } from './march.types.js'

/* Marching squares, one cell at a time: the four corners give a min and a max,
   so only the levels between them can cross. Cases 5 and 10 are ambiguous and
   are resolved the same way as the reference implementation the shipped
   segment counts came from. */

/* The sixteen levels the shipped contour layer was drawn at, from −6000 m up. */
export const hypsometricLevels: readonly number[] = Object.freeze([
  -500, -1000, -2000, -3000, -4000, -5000, -6000,
  250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000,
])

/** Vertices a level's buffer starts with; it doubles as needed. */
const initialVertices = 8192

/* Trace the height lines out of a grid. */
export const buildContours = (
  grid: ElevationGrid,
  options: ContourOptions = {},
): ContourLines => {
  const { width, height, heights } = grid
  const layout = gridLayout(grid)
  /* Inherit the view from a surface, because a surface *is* a grid — and a
     caller who has just built one should not have to say "the same one, again"
     or find their height lines hanging over a sphere of the default size. An
     explicit `options.view` still wins. */
  const project = projector({ ...defaultView, ...grid.view, ...options.view })
  const view = project.view
  const levels = resolveLevels(grid, options)
  const count = levels.length

  /* Grid space to degrees, hoisted out of the loop. These are the same two
     formulas buildSurface uses, which is why the lines land on it: column 0 at
     `columnZeroLon` with the whole span over `width` columns, and row 0 at the
     north pole with the whole span over `height - 1` gaps. */
  const { columnZeroLon, longitudeSpan, latitudeSpan } = layout
  const latitudeRows = height - 1

  /* One growable buffer per level. They are kept apart because the output groups
     segments by level — a line drawn at 1000 m and a line drawn at 250 m are the
     same geometry but not the same weight on a map, and a caller that wants to
     draw them differently should not have to scan to find where one ends. */
  const buffers: Float32Array[] = []
  const capacities = new Int32Array(count)
  const cursors = new Int32Array(count)
  for (let levelIndex = 0; levelIndex < count; levelIndex++) {
    buffers.push(new Float32Array(initialVertices * 3))
    capacities[levelIndex] = initialVertices
  }

  const grow = (levelIndex: number): void => {
    const grown = new Float32Array(capacities[levelIndex] * 6)
    grown.set(buffers[levelIndex]!)
    buffers[levelIndex] = grown
    capacities[levelIndex] *= 2
  }

  /* The four crossing points of the cell being looked at, in grid coordinates:
     x is a column (fractional), y is a row. Written every cell, allocated once,
     because a fresh array per cell would be eleven million of them. */
  const edgeX = new Float64Array(4)
  const edgeY = new Float64Array(4)

  const lastLevel = levels[count - 1]!
  const firstLevel = levels[0]!

  for (let row = 0; row < height - 1; row++) {
    const top = row * width
    const bottom = top + width

    for (let column = 0; column < width - 1; column++) {
      const topLeftHeight = heights[top + column]!
      const topRightHeight = heights[top + column + 1]!
      const bottomLeftHeight = heights[bottom + column]!
      const bottomRightHeight = heights[bottom + column + 1]!

      const cellLowest = Math.min(topLeftHeight, topRightHeight, bottomLeftHeight, bottomRightHeight)
      const cellHighest = Math.max(topLeftHeight, topRightHeight, bottomLeftHeight, bottomRightHeight)

      if (cellHighest < firstLevel || cellLowest > lastLevel) continue

      for (let levelIndex = lowerBound(levels, cellLowest); levelIndex < count; levelIndex++) {
        const level = levels[levelIndex]!
        if (level > cellHighest) break

        const topCrossing = fraction(topLeftHeight, topRightHeight, level)
        const rightCrossing = fraction(topRightHeight, bottomRightHeight, level)
        const bottomCrossing = fraction(bottomLeftHeight, bottomRightHeight, level)
        const leftCrossing = fraction(topLeftHeight, bottomLeftHeight, level)

        edgeX[0] = column + topCrossing; edgeY[0] = row
        edgeX[1] = column + 1;           edgeY[1] = row + rightCrossing
        edgeX[2] = column + bottomCrossing; edgeY[2] = row + 1
        edgeX[3] = column;               edgeY[3] = row + leftCrossing

        let code = 0
        if (topLeftHeight >= level) code |= 1
        if (topRightHeight >= level) code |= 2
        if (bottomRightHeight >= level) code |= 4
        if (bottomLeftHeight >= level) code |= 8
        if (code === 0 || code === 15) continue

        /* The sixteen cases, as edge pairs. Two of them are saddles and carry a
           second segment. Written as a table lookup would be shorter, but this
           runs eleven million times per level list and the switch compiles to a
           jump table. */
        let fromEdge: number
        let toEdge: number
        let secondFromEdge = -1
        let secondToEdge = 0
        switch (code) {
          case 1: fromEdge = 3; toEdge = 0; break
          case 2: fromEdge = 0; toEdge = 1; break
          case 3: fromEdge = 3; toEdge = 1; break
          case 4: fromEdge = 1; toEdge = 2; break
          case 5: fromEdge = 3; toEdge = 0; secondFromEdge = 1; secondToEdge = 2; break
          case 6: fromEdge = 0; toEdge = 2; break
          case 7: fromEdge = 3; toEdge = 2; break
          case 8: fromEdge = 2; toEdge = 3; break
          case 9: fromEdge = 2; toEdge = 0; break
          case 10: fromEdge = 0; toEdge = 1; secondFromEdge = 2; secondToEdge = 3; break
          case 11: fromEdge = 1; toEdge = 2; break
          case 12: fromEdge = 1; toEdge = 3; break
          case 13: fromEdge = 1; toEdge = 0; break
          case 14: fromEdge = 0; toEdge = 3; break
          default: fromEdge = 0; toEdge = 0; break
        }

        // room for the widest case before writing any of it
        if (cursors[levelIndex]! + 4 > capacities[levelIndex]!) grow(levelIndex)
        const buffer = buffers[levelIndex]!
        let writeOffset = cursors[levelIndex]! * 3

        project.write(
          buffer, writeOffset,
          columnZeroLon + (edgeX[fromEdge]! / width) * longitudeSpan,
          90 - (edgeY[fromEdge]! / latitudeRows) * latitudeSpan,
          level,
        )
        project.write(
          buffer, writeOffset + 3,
          columnZeroLon + (edgeX[toEdge]! / width) * longitudeSpan,
          90 - (edgeY[toEdge]! / latitudeRows) * latitudeSpan,
          level,
        )
        writeOffset += 6

        if (secondFromEdge >= 0) {
          project.write(
            buffer, writeOffset,
            columnZeroLon + (edgeX[secondFromEdge]! / width) * longitudeSpan,
            90 - (edgeY[secondFromEdge]! / latitudeRows) * latitudeSpan,
            level,
          )
          project.write(
            buffer, writeOffset + 3,
            columnZeroLon + (edgeX[secondToEdge]! / width) * longitudeSpan,
            90 - (edgeY[secondToEdge]! / latitudeRows) * latitudeSpan,
            level,
          )
          writeOffset += 6
        }

        cursors[levelIndex] = writeOffset / 3
      }
    }
  }

  let vertices = 0
  for (let levelIndex = 0; levelIndex < count; levelIndex++) vertices += cursors[levelIndex]!
  const positions = new Float32Array(vertices * 3)

  const outLevels: ContourLevel[] = []
  let write = 0
  for (let levelIndex = 0; levelIndex < count; levelIndex++) {
    const levelVertices = cursors[levelIndex]!
    positions.set(buffers[levelIndex]!.subarray(0, levelVertices * 3), write * 3)
    outLevels.push({
      level: levels[levelIndex]!,
      offset: write / 2,
      segments: levelVertices / 2,
    })
    write += levelVertices
  }

  return {
    kind: 'contours',
    positions,
    levels: outLevels,
    segments: write / 2,
    width,
    height,
    view,
  }
}

/** How far along a→b the level crosses, clamped to the edge. A flat edge has no
 *  crossing, so it is given the midpoint rather than a division by zero. */
const fraction = (fromValue: number, toValue: number, level: number): number => {
  const span = toValue - fromValue
  const along = span !== 0 ? (level - fromValue) / span : 0.5
  return along < 0 ? 0 : along > 1 ? 1 : along
}

/** First index whose level is >= value. Levels arrive sorted. */
const lowerBound = (levels: readonly number[], value: number): number => {
  let lowerIndex = 0
  let upperIndex = levels.length
  while (lowerIndex < upperIndex) {
    const middleIndex = (lowerIndex + upperIndex) >> 1
    if (levels[middleIndex]! < value) lowerIndex = middleIndex + 1
    else upperIndex = middleIndex
  }
  return lowerIndex
}

const resolveLevels = (grid: ElevationGrid, options: ContourOptions): number[] => {
  let levels: number[]
  if (options.levels) levels = [...options.levels]
  else if (options.every !== undefined) levels = levelsEvery(grid, options.every)
  else levels = [...hypsometricLevels]

  if (!levels.length) {
    throw new Error(
      options.every !== undefined
        ? `earthGeoData: buildContours every ${options.every} m found no height in the grid to ` +
          'trace — the grid is flatter than that, or the step is bigger than its whole range'
        : 'earthGeoData: buildContours needs at least one level',
    )
  }
  for (const level of levels) {
    if (!Number.isFinite(level)) {
      throw new Error(`earthGeoData: contour level ${level} is not a finite number of metres`)
    }
  }

  levels.sort((left, right) => left - right)
  const unique: number[] = []
  for (const level of levels) {
    if (!unique.length || unique[unique.length - 1] !== level) unique.push(level)
  }
  return unique
}

const levelsEvery = (grid: ElevationGrid, every: number): number[] => {
  if (!(every > 0)) {
    throw new Error(`earthGeoData: contours every ${every} — it has to be more than 0 metres`)
  }
  const { min, max } = grid.data.range ?? scanRange(grid.heights)
  const levels: number[] = []
  const firstStep = Math.ceil(min / every)
  const lastStep = Math.floor(max / every)
  for (let step = firstStep; step <= lastStep; step++) levels.push(step * every)
  return levels
}

const scanRange = (values: Float32Array): { min: number; max: number } => {
  let min = Infinity
  let max = -Infinity
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}
