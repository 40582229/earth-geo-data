import type { GridShape } from '../../dataset/container/index.js'
import type { GlobeView } from '../../projection/projector/index.js'

/** One traced level: where its segments start, and how many there are. */
export type ContourLevel = {
  level: number
  offset: number
  segments: number
}

/** Height lines, ready for a line-segment buffer: two vertices per segment.
 *
 *  There is no `info` block here, unlike a surface. A surface's info holds what
 *  a pass over its 8 M vertices measured; tracing lines measures nothing that
 *  is not already in `levels` and `segments`, and a block that only repeated
 *  them would be a second place to keep the same number right. */
export type ContourLines = GridShape & {
  kind: 'contours'
  /** xyz, two vertices per segment, grouped by level in ascending order. To draw
   *  one level, start at `levels[levelIndex].offset * 6` floats and take
   *  `levels[levelIndex].segments * 6`. */
  positions: Float32Array
  levels: ContourLevel[]
  /** Over every level, so it is the sum of `levels[].segments`. */
  segments: number
  /** The view the lines were built with — the same object a surface carries, so
   *  lines and terrain built from one view cannot disagree about where they are. */
  view: GlobeView
}

export type ContourOptions = {
  /** Which heights to trace, in metres. Default: hypsometricLevels. */
  levels?: readonly number[]
  every?: number
  view?: Partial<GlobeView>
}
