import type { GlobeView, Surface } from '../projection/projector.js'
import { DEFAULT_VIEW, projector } from '../projection/projector.js'
import type { ElevationGrid } from '../elevation/grid.js'
import { gridLayout } from '../elevation/layout.js'

/* ════════════════════════════════════════════════════════════════════════════
   contours — the height lines

   A contour is the set of points at one height. On the ground that is a closed
   loop round a hill, a ring round a hollow, a line running down a valley and out
   to sea. On a map it is the thin black line that makes a hill look like a hill.

   There are two ways to get them. You can draw them once, into a file, at a fixed
   set of heights. Or you can trace them out of the grid whenever you want them,
   at whatever heights you want them. This does the second.

   ── the algorithm is marching squares, and it is 16 cases ────────────────────

   Take one cell — four corners — and ask of each corner: is it above this level,
   or below? Four yes/no answers is 16 possibilities. Two of them (all above, all
   below) produce nothing. The other fourteen produce one or two short segments
   whose ends sit at an interpolated position along the cell's edges:

         ┌─────3─────┐          bit 1 = top-left      edge 0 = top
         │           │          bit 2 = top-right     edge 1 = right
         0           1          bit 4 = bottom-right  edge 2 = bottom
         │           │          bit 8 = bottom-left   edge 3 = left
         └─────2─────┘

   Interpolation, not rounding, is what makes the line smooth instead of a
   staircase: the crossing point on an edge is where the height actually passes
   through the level, not the nearest corner.

   Two cases are ambiguous — 5 (top-left and bottom-right above) and 10 (the
   other diagonal). The contour could cut either way, and the two ways are the
   two saddles a hill's shoulder can have. They are resolved the same way here as
   in the reference implementation that produced the shipped 838,605-segment
   layer, so the two agree exactly: case 5 gives (left→top) + (right→bottom),
   case 10 gives (top→right) + (bottom→left).

   ── why one level list, not one level ───────────────────────────────────────

   Tracing each level separately means walking the whole grid 16 times. Instead
   each cell is looked at once: its four corners give a min and a max, and only
   the levels that fall between them can possibly cross it. On real terrain that
   is two or three levels per cell, not sixteen.
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * The sixteen levels the shipped contour layer was drawn at, from −6000 m up.
 *
 * Deliberately uneven. Sea level to the abyssal plains is a long way and mostly
 * flat, so the undersea lines are spaced in thousands; land is where people look,
 * so it gets 250, 500, 1000, 1500 … and the last few hundred metres of the
 * Himalaya get their own line at 6000.
 */
export const HYPSOMETRIC_LEVELS: readonly number[] = Object.freeze([
  -500, -1000, -2000, -3000, -4000, -5000, -6000,
  250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6000,
])

/** One traced level: where its segments start, and how many there are. */
export type ContourLevel = {
  level: number
  /** Index of this level's first segment within `positions`, in segments. */
  offset: number
  segments: number
}

export type ContourInfo = {
  width: number
  height: number
  /** How many levels were asked for — including any that crossed nothing. */
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
  /** Ascending by `level`. Levels that crossed nothing are still here, with
   *  `segments: 0` — so the list you get back is the list you asked for. */
  levels: ContourLevel[]
  segments: number
  info: ContourInfo
}

export type ContourOptions = {
  /** Which heights to trace, in metres. Default: HYPSOMETRIC_LEVELS. */
  levels?: readonly number[]
  /** Or: every N metres, from the grid's own lowest to its highest. Ignored when
   *  `levels` is given. Ask for what you need — on a 4096 grid, `every: 100` is
   *  179 levels, 17.2 million segments and 412 MB, against the default sixteen's
   *  2.2 million and 53 MB. Doubling the levels doubles both, so an even spacing
   *  over the whole planet is almost never what you want. */
  every?: number
  /** The same view you gave the surface, so the lines land on it. */
  view?: Partial<GlobeView>
}

/** Vertices a level's buffer starts with; it doubles as needed. */
const INITIAL_VERTICES = 8192

/**
 * Trace the height lines out of a grid.
 *
 *   const lines = buildContours(grid)                       // the 16
 *   const lines = buildContours(grid, { every: 100 })       // every 100 m
 *   const lines = buildContours(grid, { levels: [1000] })   // one height
 *
 * Positions come out through the same projector the surface uses, so with the
 * same `view` the lines sit exactly on the terrain — on a sphere or on a plane.
 */
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
  const project = projector({ ...DEFAULT_VIEW, ...grid.view, ...options.view })
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
    buffers.push(new Float32Array(INITIAL_VERTICES * 3))
    capacities[i] = INITIAL_VERTICES
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

    /* One column short: a cell needs two distinct grid columns, and the last
       column of an equirectangular grid is one step short of a full turn. So the
       sliver between the last column and column 0 — the antimeridian — has no
       cell of its own. The shipped layer has the same gap; the seam is closed by
       the geometry, not by a contour that runs along it. */
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

        /* Where the level crosses each of the four edges, as a fraction from the
           first corner named — top from top-left, right from top-right, bottom
           from bottom-left, left from top-left. A flat edge (b === a) has no
           crossing, and 0.5 is what the reference implementation chose for the
           degenerate case: it places the vertex mid-edge rather than at a corner,
           which keeps the segment away from the vertices that two cells share. */
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

  /* ── join the levels into one buffer ─────────────────────────────────────
     One Float32Array rather than sixteen is what a line-segment buffer wants:
     one upload, one draw call, and the level offsets let a caller still draw a
     single height if it wants to. */
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
  else levels = [...HYPSOMETRIC_LEVELS]

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
  /* Counted in whole multiples rather than accumulated, so `every: 100` lands on
     exactly -1000 rather than -999.9999999999998 after thirty additions. */
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
