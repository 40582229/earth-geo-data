/* earth-geo-data — a grid becomes a surface, its height lines become vectors,
   and the ground takes the colour of what grows on it.

   No renderer is imported; everything comes back as typed arrays.

     const surface = await loadSurface('terrain-4096')
     const lines   = buildContours(surface, { every: 100 }) */

export * from './dataset/index.js'
export * from './projection/index.js'
export * from './colour/index.js'
export * from './source/index.js'
export * from './elevation/index.js'
export * from './contours/index.js'
export * from './landcover/index.js'
