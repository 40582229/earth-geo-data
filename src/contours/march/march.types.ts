import type { GlobeView, Surface } from '../../projection/projector/index.js'

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
   *  one level, start at `levels[levelIndex].offset * 6` floats and take
   *  `levels[levelIndex].segments * 6`. */
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
