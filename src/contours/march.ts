import type { GlobeView, Surface } from '../projection/projector.js'
import { defaultView, projector } from '../projection/projector.js'
import type { ElevationGrid } from '../elevation/grid.js'
import { gridLayout } from '../elevation/layout.js'

/* Marching squares, one cell at a time: the four corners give a min and a max,
   so only the levels between them can cross. Cases 5 and 10 are ambiguous and
   are resolved the same way as the reference implementation the shipped
   segment counts came from. */

/* The sixteen levels the shipped contour layer was drawn at, from −6000 m up. */
export const hypsometricLevels: readonly number[] = Object.freeze([
  -500, -1000, -2000, -3000, -4000, -5000, -6000,
  250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000,
])

/** One traced level: where its segments start, and how many there are. */
export type ContourLevel = {
  level: number
  offset: number
  segments: number
}

export type ContourInfo = {
  width: number
  height: number
  levels: number
  segments: number
  vertices: number
  surface: Surface
  radius: number
  heightExaggeration: number
  longitudeOffset: number
}

/** Height lines, ready for a line-segment buffer: two vertices per segment. */
export type ContourLines = {
  kind: 'contours'
  /** xyz, two vertices per segment, grouped by level in ascending order. To draw
   *  one level, start at `levels[i].offset * 6` floats and take
   *  `levels[i].segments * 6`. */
  positions: Float32Array
  levels: ContourLevel[]
  segments: number
  info: ContourInfo
}

export type ContourOptions = {
  /** Which heights to trace, in metres. Default: hypsometricLevels. */
  levels?: readonly number[]
  every?: number
  view?: Partial<GlobeView>
}

/** Vertices a level's buffer starts with; it doubles as needed. */
const initialVertices = 8192

/* Trace the height lines out of a grid. */
export function buildContours(
  grid: ElevationGrid,
  options: ContourOptions = {},
): ContourLines {
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
  for (let i = 0; i < count; i++) {
    buffers.push(new Float32Array(initialVertices * 3))
    capacities[i] = initialVertices
  }

  const grow = (i: number): void => {
    const next = new Float32Array(capacities[i] * 6)
    next.set(buffers[i]!)
    buffers[i] = next
    capacities[i] *= 2
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
      const h00 = heights[top + column]!
      const h01 = heights[top + column + 1]!
      const h10 = heights[bottom + column]!
      const h11 = heights[bottom + column + 1]!

      const low = Math.min(h00, h01, h10, h11)
      const high = Math.max(h00, h01, h10, h11)

      if (high < firstLevel || low > lastLevel) continue

      for (let i = lowerBound(levels, low); i < count; i++) {
        const level = levels[i]!
        if (level > high) break

        const tt = fraction(h00, h01, level)
        const tr = fraction(h01, h11, level)
        const tb = fraction(h10, h11, level)
        const tl = fraction(h00, h10, level)

        edgeX[0] = column + tt; edgeY[0] = row
        edgeX[1] = column + 1;  edgeY[1] = row + tr
        edgeX[2] = column + tb; edgeY[2] = row + 1
        edgeX[3] = column;      edgeY[3] = row + tl

        let code = 0
        if (h00 >= level) code |= 1
        if (h01 >= level) code |= 2
        if (h11 >= level) code |= 4
        if (h10 >= level) code |= 8
        if (code === 0 || code === 15) continue

        /* The sixteen cases, as edge pairs. Two of them are saddles and carry a
           second segment. Written as a table lookup would be shorter, but this
           runs eleven million times per level list and the switch compiles to a
           jump table. */
        let a: number
        let b: number
        let a2 = -1
        let b2 = 0
        switch (code) {
          case 1: a = 3; b = 0; break
          case 2: a = 0; b = 1; break
          case 3: a = 3; b = 1; break
          case 4: a = 1; b = 2; break
          case 5: a = 3; b = 0; a2 = 1; b2 = 2; break
          case 6: a = 0; b = 2; break
          case 7: a = 3; b = 2; break
          case 8: a = 2; b = 3; break
          case 9: a = 2; b = 0; break
          case 10: a = 0; b = 1; a2 = 2; b2 = 3; break
          case 11: a = 1; b = 2; break
          case 12: a = 1; b = 3; break
          case 13: a = 1; b = 0; break
          case 14: a = 0; b = 3; break
          default: a = 0; b = 0; break
        }

        // room for the widest case before writing any of it
        if (cursors[i]! + 4 > capacities[i]!) grow(i)
        const out = buffers[i]!
        let at = cursors[i]! * 3

        project.write(
          out, at,
          columnZeroLon + (edgeX[a]! / width) * longitudeSpan,
          90 - (edgeY[a]! / latitudeRows) * latitudeSpan,
          level,
        )
        project.write(
          out, at + 3,
          columnZeroLon + (edgeX[b]! / width) * longitudeSpan,
          90 - (edgeY[b]! / latitudeRows) * latitudeSpan,
          level,
        )
        at += 6

        if (a2 >= 0) {
          project.write(
            out, at,
            columnZeroLon + (edgeX[a2]! / width) * longitudeSpan,
            90 - (edgeY[a2]! / latitudeRows) * latitudeSpan,
            level,
          )
          project.write(
            out, at + 3,
            columnZeroLon + (edgeX[b2]! / width) * longitudeSpan,
            90 - (edgeY[b2]! / latitudeRows) * latitudeSpan,
            level,
          )
          at += 6
        }

        cursors[i] = at / 3
      }
    }
  }

  let vertices = 0
  for (let i = 0; i < count; i++) vertices += cursors[i]!
  const positions = new Float32Array(vertices * 3)

  const outLevels: ContourLevel[] = []
  let write = 0
  for (let i = 0; i < count; i++) {
    const levelVertices = cursors[i]!
    positions.set(buffers[i]!.subarray(0, levelVertices * 3), write * 3)
    outLevels.push({
      level: levels[i]!,
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
    info: {
      width,
      height,
      levels: count,
      segments: write / 2,
      vertices: write,
      surface: view.surface,
      radius: view.radius,
      heightExaggeration: view.heightExaggeration,
      longitudeOffset: view.longitudeOffset,
    },
  }
}

/** How far along a→b the level crosses, clamped to the edge. A flat edge has no
 *  crossing, so it is given the midpoint rather than a division by zero. */
function fraction(a: number, b: number, level: number): number {
  const span = b - a
  const along = span !== 0 ? (level - a) / span : 0.5
  return along < 0 ? 0 : along > 1 ? 1 : along
}

/** First index whose level is >= value. Levels arrive sorted. */
function lowerBound(levels: readonly number[], value: number): number {
  let low = 0
  let high = levels.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (levels[mid]! < value) low = mid + 1
    else high = mid
  }
  return low
}

function resolveLevels(grid: ElevationGrid, options: ContourOptions): number[] {
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

  levels.sort((a, b) => a - b)
  const unique: number[] = []
  for (const level of levels) {
    if (!unique.length || unique[unique.length - 1] !== level) unique.push(level)
  }
  return unique
}

function levelsEvery(grid: ElevationGrid, every: number): number[] {
  if (!(every > 0)) {
    throw new Error(`earthGeoData: contours every ${every} — it has to be more than 0 metres`)
  }
  const { min, max } = grid.data.range ?? scanRange(grid.heights)
  const levels: number[] = []
  const first = Math.ceil(min / every)
  const last = Math.floor(max / every)
  for (let step = first; step <= last; step++) levels.push(step * every)
  return levels
}

function scanRange(values: Float32Array): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}
