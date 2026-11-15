import type { GlobeView } from '../../projection/projector/index.js'

/** Land outlines as a line-segment buffer: two xyz vertices per segment. */
export type BoundaryLines = {
  kind: 'boundaries'
  /** xyz, two vertices per segment, rings one after another. */
  positions: Float32Array
  segments: number
  /** The resolved view, so it can be handed on the way a surface's is. */
  view: GlobeView
}

export type BoundaryOptions = {
  /** Pass `surface.view` to land the lines on the sphere the terrain was built with. */
  view?: Partial<GlobeView>
  /** Metres above the surface, so a line draws over the terrain rather than in it. Default `defaultLiftM`. */
  liftM?: number
}
