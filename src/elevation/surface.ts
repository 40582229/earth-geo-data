import type { EarthGeoData } from '../dataset/container.js'
import type { Color3 } from '../colour/types.js'
import { elevationColor } from '../colour/ramp.js'
import type { ElevationSampler, GlobeView, Surface } from '../projection/projector.js'
import { defaultView, projector, samplerFromGrid } from '../projection/projector.js'
import { openDataset } from '../source/index.js'
import type { SourceOptions } from '../source/index.js'
import type { ElevationGrid } from './grid.js'
import { gridLayout } from './layout.js'

/* Grid indices become angles — column to longitude, row to latitude — and the
   height pushes the point out from the centre. 'plane' turns the same two
   indices into distances instead. Read those four numbers off the header; do
   not assume column 0 is -180. */

/* The colour of one vertex, in the space a vertex buffer wants — linear, not sRGB. */
export type SurfaceColour = (value: number, row: number, column: number) => Color3

/** What the surface turned out to be. Every number here was measured while
 *  building it, so a caller can print it or assert on it without a second pass. */
export type SurfaceInfo = {
  grid: string
  vertices: number
  triangles: number
  lowestMetres: number
  highestMetres: number
  /** Distance from the centre (sphere) or height above the plane's zero (plane),
   *  measured over every vertex — the actual extent of the geometry, not the
   *  requested one. */
  radiusMin: number
  radiusMax: number
  belowSeaLevelShare: number
  radius: number
  heightExaggeration: number
  longitudeOffset: number
  surface: Surface
  columnZeroLon: number
  /** Degrees of longitude per column: the span over `width` columns, not
   *  `width - 1`. The latitude step is a different number — rows include both
   *  poles, columns do not repeat a meridian — so it is separate. */
  cellDegrees: number
  cellDegreesLat: number
}

/** A surface ready for a vertex buffer: three arrays, nothing else required. */
export type ElevationSurface = {
  kind: 'surface'
  positions: Float32Array
  /** Linear rgb, one triple per vertex — the default elevation ramp unless
   *  `colourOf` said otherwise. */
  colors: Float32Array
  indices: Uint32Array
  count: number
  width: number
  height: number
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

/* Turn a height grid into xyz positions, rgb colours and indices. */
export const buildSurface = (
  grid: ElevationGrid,
  options: SurfaceOptions = {},
): ElevationSurface => {
  const { width, height, heights } = grid
  const layout = gridLayout(grid)
  const project = projector({ ...defaultView, ...options.view })
  const view = project.view
  const colourOf: SurfaceColour = options.colourOf ?? ((metres) => elevationColor(metres))

  /* One extra column is written at the meridian after the last one so the seam
     closes: that vertex's height is column 0's, and its longitude is one whole
     span past column 0, which is the same direction — so the last strip of
     triangles meets the first one. Hence the loop goes to `column <= width`. */
  const columns = width + 1
  const count = columns * height

  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  let write = 0

  let lowest = Infinity
  let highest = -Infinity
  let radiusMin = Infinity
  let radiusMax = 0
  let belowSeaLevel = 0

  for (let row = 0; row < height; row++) {
    // latitude: row 0 is the north pole, the last row is the south pole. The
    // rows span the pole-to-pole span over height-1 gaps, which is exactly how
    // many gaps there are between the first row and the last.
    const latitude = 90 - (row / (height - 1)) * layout.latitudeSpan

    for (let column = 0; column < columns; column++) {
      const longitude = layout.columnZeroLon + (column / width) * layout.longitudeSpan

      // the height at this point, in metres. The final column reuses column 0.
      const metres = heights[row * width + (column % width)]

      /* The radius comes back from the projection rather than being measured
         again from the vertex: it is the same number, and a second pass with a
         hypot() per vertex is 26 million square roots on the 7200 grid. */
      const radius = project.write(positions, write, longitude, latitude, metres)
      if (radius < radiusMin) radiusMin = radius
      if (radius > radiusMax) radiusMax = radius

      // The colour for this same vertex, from the same `metres`.
      // elevationColor hands back one reused triple, so the three numbers go
      // straight into the array before the next call overwrites them — and a
      // colour function passed in is expected to behave the same way.
      const rgb = colourOf(metres, row, column)
      colors[write] = rgb[0]
      colors[write + 1] = rgb[1]
      colors[write + 2] = rgb[2]

      if (metres < lowest) lowest = metres
      if (metres > highest) highest = metres
      if (metres < 0) belowSeaLevel++

      write += 3
    }
  }

  const indices = new Uint32Array((columns - 1) * (height - 1) * 6)
  let corner = 0
  for (let row = 0; row < height - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const topLeft = row * columns + column
      const topRight = topLeft + 1
      const bottomLeft = topLeft + columns
      const bottomRight = bottomLeft + 1

      indices[corner++] = topLeft
      indices[corner++] = bottomLeft
      indices[corner++] = topRight

      indices[corner++] = topRight
      indices[corner++] = bottomLeft
      indices[corner++] = bottomRight
    }
  }

  return {
    kind: 'surface',
    positions,
    colors,
    indices,
    count,
    width,
    height,
    view,
    heights,
    info: {
      grid: `${width}x${height}`,
      vertices: count,
      triangles: indices.length / 3,
      lowestMetres: lowest,
      highestMetres: highest,
      radiusMin,
      radiusMax,
      belowSeaLevelShare: belowSeaLevel / count,
      radius: view.radius,
      heightExaggeration: view.heightExaggeration,
      longitudeOffset: view.longitudeOffset,
      surface: view.surface,
      columnZeroLon: layout.columnZeroLon,
      cellDegrees: layout.longitudeSpan / width,
      cellDegreesLat: layout.latitudeSpan / (height - 1),
    },
    sample: samplerFromGrid(grid.data),
    data: grid.data,
  }
}

/* The one call a first look needs: fetch, decode, and hand back three arrays you can put straight into… */
export const loadSurface = async (
  source = 'terrain-1024',
  options: LoadOptions = {},
): Promise<ElevationSurface> => {
  const data = await openDataset(source, options)
  return buildSurfaceFromData(data, options)
}

/** Build a surface from a dataset you already have. */
export const buildSurfaceFromData = (
  data: EarthGeoData,
  options: SurfaceOptions = {},
): ElevationSurface => {
  if (!data.grid) {
    throw new Error(
      `earthGeoData/${data.id}: kind is "${data.kind}", not a grid — there is no surface in it`,
    )
  }
  return buildSurface(
    { data, width: data.grid.width, height: data.grid.height, heights: data.gridValues() },
    options,
  )
}
