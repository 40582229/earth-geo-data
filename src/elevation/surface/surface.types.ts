import type { Color3 } from '../../colour/types.js'
import type { EarthGeoData, GridShape } from '../../dataset/container/index.js'
import type { ElevationSampler, GlobeView } from '../../projection/projector/index.js'
import type { SourceOptions } from '../../source/index.js'

/* The colour of one vertex, in the space a vertex buffer wants — linear, not sRGB. */
export type SurfaceColour = (value: number, row: number, column: number) => Color3

/** What a pass over the vertices measured, plus the grid's layout in degrees.
 *
 *  Nothing here repeats the surface it sits on: the width, the height, the
 *  vertex count, every setting of the view and the grid header are all fields
 *  of the surface itself. The triangle count is the one headline number with no
 *  field of its own, so it is here. */
export type SurfaceInfo = {
  lowestMetres: number
  highestMetres: number
  /** Distance from the centre (sphere) or height above the plane's zero (plane),
   *  measured over every vertex — the actual extent of the geometry, not the
   *  requested one. */
  radiusMin: number
  radiusMax: number
  belowSeaLevelShare: number
  triangles: number
  columnZeroLon: number
  /** Degrees of longitude per column: the span over `width` columns, not
   *  `width - 1`. The latitude step is a different number — rows include both
   *  poles, columns do not repeat a meridian — so it is separate. */
  cellDegrees: number
  cellDegreesLat: number
}

/** A surface ready for a vertex buffer: three arrays, nothing else required. */
export type ElevationSurface = GridShape & {
  kind: 'surface'
  positions: Float32Array
  /** Linear rgb, one triple per vertex — the default elevation ramp unless
   *  `colourOf` said otherwise. */
  colors: Float32Array
  indices: Uint32Array
  count: number
  /** The view it was built with, in full. Anything drawn on this surface should
   *  use it — `buildContours(surface)` reads it from here so the lines land on
   *  the terrain instead of on a different-sized sphere. */
  view: GlobeView
  heights: Float32Array
  info: SurfaceInfo
  sample: ElevationSampler
  data: EarthGeoData
}

export type SurfaceOptions = {
  /** Where to put the surface and what shape it is. `surface: 'plane'` gives the
   *  same grid laid out flat — pass the same view to anything you want on it.
   *  Default: the globe in defaultView, radius 6, relief at 30x. */
  view?: Partial<GlobeView>

  colourOf?: SurfaceColour
}

export type LoadOptions = SourceOptions & SurfaceOptions
