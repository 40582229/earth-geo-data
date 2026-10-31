import type { EarthGeoData } from '../dataset/container.js'
import type { Color3 } from '../colour/types.js'
import { elevationColor } from '../colour/ramp.js'
import type { ElevationSampler, GlobeView, Surface } from '../projection/projector.js'
import { DEFAULT_VIEW, projector, samplerFromGrid } from '../projection/projector.js'
import { openDataset } from '../source/index.js'
import type { SourceOptions } from '../source/index.js'
import type { ElevationGrid } from './grid.js'
import { gridLayout } from './layout.js'

/* ════════════════════════════════════════════════════════════════════════════
   surface — an elevation grid becomes a sphere, or a flat map

   This is the conversion the whole package exists to make one line:

     heights  is one number per grid cell — an altitude, with no x and no z.
              Handing it straight to a three-component vertex buffer is the
              classic NaN: 524288 numbers is not divisible by 3, so the last
              vertex reads past the end of the array and comes back undefined.

     A globe is just an equirectangular map, so the two grid indices become two
     angles:

       column -> longitude   columnZeroLon .. columnZeroLon + longitudeSpan
       row    -> latitude    +90 .. -90  (north pole down to south pole)

     and the height pushes the point out from the centre by that much more. A
     plane is the same two grid indices becoming two *distances* instead, which
     is the same grid one projection apart.

     ── read those four numbers off the header; do not assume them ────────────
     The header says where column 0 is, how far the columns run, how far the rows
     run and which end row 0 is. `columnZeroLon` is -180 in every file shipped
     here, and an earlier version of this loop started the columns at 0 anyway —
     which put every mountain 180° from where it belongs. Nothing could see it:
     the globe is a sphere, and the colour for a vertex is chosen from the height
     the same vertex was built from, so a globe rotated about its axis looks
     perfect. It only shows up against something drawn a different way, like a
     coastline, which then floats over the ocean on the far side of the planet.

   `options.view.surface` picks the shape and nothing else changes: 'sphere' is
   the globe below, 'plane' lays the identical positions-and-indices out flat,
   with x/z from the grid instead of trigonometry. The projection itself lives in
   ../projection, so asking for a plane here also flattens every other layer
   built with the same view — which is the only way a coastline stays on its land.
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * The colour of one vertex, in the space a vertex buffer wants — linear, not sRGB.
 *
 * `value` is the grid's number in its own unit, which for a height grid is
 * metres and for a class grid is a class code. `row` and `column` are the cell
 * the value came from, so a caller can index a second array without dividing the
 * vertex number by a width.
 *
 * Returning one reused triple is fine and is what the default does: the three
 * numbers are copied into the array before the next call.
 */
export type SurfaceColour = (value: number, row: number, column: number) => Color3

/** What the surface turned out to be. Every number here was measured while
 *  building it, so a caller can print it or assert on it without a second pass. */
export type SurfaceInfo = {
  /** `"<width>x<height>"`, the grid it came from. */
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
  /** Share of vertices whose cell was below sea level. */
  belowSeaLevelShare: number
  radius: number
  heightExaggeration: number
  longitudeOffset: number
  /** 'sphere' or 'plane' — so anything that re-projects these positions (a
   *  renderer, a check, a second layer) does it on the shape they were built on. */
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
  /** xyz, one triple per vertex. */
  positions: Float32Array
  /** Linear rgb, one triple per vertex — the default elevation ramp unless
   *  `colourOf` said otherwise. */
  colors: Float32Array
  /** Three indices per triangle, clockwise seen from outside. */
  indices: Uint32Array
  count: number
  width: number
  height: number
  /** The view it was built with, in full. Anything drawn on this surface should
   *  use it — `buildContours(surface)` reads it from here so the lines land on
   *  the terrain instead of on a different-sized sphere. */
  view: GlobeView
  /** The heights the positions were built from, still in metres — so a second
   *  layer can be draped over the same terrain with `samplerFromGrid()`. */
  heights: Float32Array
  info: SurfaceInfo
  /** Feed this to anything that should follow the ground instead of the sphere. */
  sample: ElevationSampler
  /** The dataset, for its `.credit` line — three of the licences in this format
   *  legally require attribution. */
  data: EarthGeoData
}

export type SurfaceOptions = {
  /** Where to put the surface and what shape it is. `surface: 'plane'` gives the
   *  same grid laid out flat — pass the same view to anything you want on it.
   *  Default: the globe in DEFAULT_VIEW, radius 6, relief at 30x. */
  view?: Partial<GlobeView>

  /** How to colour a vertex. Default: the elevation ramp.
   *
   *  Named `colourOf` rather than `colour` because `colour` already means a
   *  colour rule in the other loaders — a rule reads a field per record, and this
   *  is one function per cell. Two different things, two different names. */
  colourOf?: SurfaceColour
}

export type LoadOptions = SourceOptions & SurfaceOptions

/**
 * Turn a height grid into xyz positions, rgb colours and indices.
 *
 * The surface is a sphere unless `options.view.surface` says 'plane'. Everything
 * downstream of the `heights` array is identical either way, including the index
 * buffer: the two shapes differ only in what the projector writes, which is why
 * the switch costs one branch and no second copy of this loop.
 */
export function buildSurface(
  grid: ElevationGrid,
  options: SurfaceOptions = {},
): ElevationSurface {
  const { width, height, heights } = grid
  const layout = gridLayout(grid)
  const project = projector({ ...DEFAULT_VIEW, ...options.view })
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
      /* Longitude, straight from the header: column 0 sits at `columnZeroLon`
         and the columns run `longitudeSpan` over `width` of them. Not
         `width - 1` — the last column is one step short of a full turn, and the
         extra column above closes the gap. The header's own FORMAT.md used to
         say `width - 1`, which squashed the map by a cell and pushed the far
         east about 10 km off; a coastline agrees with `width` measurably better
         at every resolution it was measured at. */
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

  /* ── the index ───────────────────────────────────────────────────────────
     Two triangles per grid cell, and the order inside each triple matters: read
     the three corners in this order and the triangle comes out facing away from
     the centre. Get it backwards and the material culls the near side, so you
     see the inside of the planet instead of the outside.

       a --- b        a = row,   column
       |   / |        b = row,   column + 1
       c --- d        c = row+1, column
                      d = row+1, column + 1

     a, c, b  and  b, c, d

     NOTE: this order is tied to the minus sign on z inside the projector.
     Negating z reverses the winding of every triangle on the whole sphere, so if
     you ever flip that sign back you must swap these two triples again, or the
     globe turns inside out and you see through it.

     The plane needs no second copy of this. It puts north at -z and east at +x,
     so a row step goes +z and a column step goes +x, and the same triple that
     faces away from the centre on a sphere faces +y on a flat map — up, towards
     the camera. Both shapes therefore share one index buffer, which is exactly
     what the tests assert; a plane whose winding was reversed would be an
     invisible map, not an error. */
  const indices = new Uint32Array((columns - 1) * (height - 1) * 6)
  let face = 0
  for (let row = 0; row < height - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1

      indices[face++] = a
      indices[face++] = c
      indices[face++] = b

      indices[face++] = b
      indices[face++] = c
      indices[face++] = d
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

/**
 * The one call a first look needs: fetch, decode, and hand back three arrays you
 * can put straight into vertex buffers.
 *
 *   const surface = await loadSurface('terrain-2048', { view: { surface: 'plane' } })
 *   geometry.setAttribute('position', new BufferAttribute(surface.positions, 3))
 *   geometry.setAttribute('color', new BufferAttribute(surface.colors, 3))
 *   geometry.setIndex(new BufferAttribute(surface.indices, 1))
 */
export async function loadSurface(
  source = 'terrain-1024',
  options: LoadOptions = {},
): Promise<ElevationSurface> {
  const data = await openDataset(source, options)
  return buildSurfaceFromData(data, options)
}

/** Build a surface from a dataset you already have. */
export function buildSurfaceFromData(
  data: EarthGeoData,
  options: SurfaceOptions = {},
): ElevationSurface {
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
