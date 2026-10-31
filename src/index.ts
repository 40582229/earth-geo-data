/* ════════════════════════════════════════════════════════════════════════════
   earth-geo-data

   Elevation data, land cover, and the loaders a first look needs: a grid becomes
   a surface, the surface's height lines become vectors, and the ground gets the
   colour of whatever is growing on it.

   Nothing here imports a renderer. A loader's whole output is typed arrays —
   positions, colours, indices — because that is the one thing every renderer,
   every engine and every native binding can agree on.

     import { loadSurface, buildContours } from 'earth-geo-data'

     const surface = await loadSurface('terrain-2048', { view: { surface: 'plane' } })
     const lines   = buildContours(surface, { every: 100 })

     geometry.setAttribute('position', new BufferAttribute(surface.positions, 3))
     geometry.setAttribute('color',    new BufferAttribute(surface.colors, 3))
     geometry.setIndex(surface.indices)

   Colour comes from height alone by default, which is why a globe built from
   `loadSurface` looks like a relief map: green lowlands, white peaks, and a
   Sahara the same colour as the Amazon. Adding the second raster fixes that,
   and costs one line:

     import { buildSurface, loadElevationGrid, loadLandCover, earthColours } from 'earth-geo-data'

     const elevation = await loadElevationGrid('terrain-4096')
     const cover     = await loadLandCover('landcover-4096')
     const surface   = buildSurface(elevation, { colourOf: earthColours(elevation, cover) })

   Every folder below is also its own entry point, for a build that would rather
   import one loader than all of them:

     earth-geo-data/dataset      the earthGeoData/1 container
     earth-geo-data/source       reading a dataset, from disk or over HTTP
     earth-geo-data/projection   lon/lat to xyz, once, for everything
     earth-geo-data/colour       the elevation ramp
     earth-geo-data/elevation    a grid becomes a globe or a flat map
     earth-geo-data/contours     the height lines
     earth-geo-data/landcover    what is growing on the ground
   ════════════════════════════════════════════════════════════════════════════ */

export * from './dataset/index.js'
export * from './projection/index.js'
export * from './colour/index.js'
export * from './source/index.js'
export * from './elevation/index.js'
export * from './contours/index.js'
export * from './landcover/index.js'
