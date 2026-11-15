import type { EarthGeoData } from '../../dataset/container/index.js'
import type { Axes, ElevationSampler, GlobeView, Projector } from './projector.types.js'

/* lon/lat -> xyz, once, so no two layers can disagree about where anything is:

     x =  r·cos(lat)·cos(lon)
     y =  r·sin(lat)
     z = -r·cos(lat)·sin(lon)

   'plane' lays the same grid out flat instead: 2·radius wide, radius deep. */

/** Mean radius of the Earth in metres — the divisor that turns elevation into a
 *  fraction of the sphere. The real figure varies 6357 km (poles) to 6378 km
 *  (equator); a globe 0.3% out of round is not a globe anyone can see. */
export const earthRadiusM = 6371000

/* The rotation lesson 06 uses: a globe of radius 6, relief at 30x, turned so that 0°E — Africa and Europe —… */
export const defaultView: GlobeView = {
  radius: 6,
  heightExaggeration: 30,
  longitudeOffset: -45,
  surface: 'sphere',
}

/* Overlays — coastlines, borders, cities — are drawn *over* the terrain, and the terrain is a surface, not a… */
export const defaultLiftM = 500

/** Degrees → radians, once, so the hot loops are one multiply. */
const radians = Math.PI / 180

export const projector = (view: Partial<GlobeView> = {}): Projector => {
  const resolvedView: GlobeView = { ...defaultView, ...view }
  const relief = resolvedView.heightExaggeration / earthRadiusM
  const longitudeOffsetRadians = resolvedView.surface === 'sphere' ? resolvedView.longitudeOffset * radians : 0

  if (resolvedView.surface === 'plane') {
    const perDegree = resolvedView.radius / 180
    /* The same metres-to-units factor the sphere uses, deliberately: switching a
       layer between sphere and plane is then a change of shape and not a change
       of scale, and the Andes are the same height in both. */
    const perMetre = resolvedView.radius * relief

    return {
      view: resolvedView,

      radius(metres: number): number {
        return metres * perMetre
      },

      write(target, offset, longitude, latitude, metres = 0): number {
        const heightOffset = metres * perMetre
        target[offset] = longitude * perDegree
        target[offset + 1] = heightOffset
        // north at -z, so a camera above the map with -z up sees north at the
        // top and east to the right — the same way round as the globe, which is
        // why an overlay needs no special case. It also leaves the triangles
        // facing +y with the index order globe.ts already writes.
        target[offset + 2] = -latitude * perDegree
        return heightOffset
      },

      frame(target, offset): number {
        /* A flat map has the same frame everywhere: up is up, north is -z and
           east is +x, which is exactly where `write` puts a degree. */
        target[offset] = 0
        target[offset + 1] = 1
        target[offset + 2] = 0
        target[offset + 3] = 0
        target[offset + 4] = 0
        target[offset + 5] = -1
        target[offset + 6] = 1
        target[offset + 7] = 0
        target[offset + 8] = 0
        return offset + 9
      },

      spin(longitude: number): number {
        return longitude
      },
    }
  }

  return {
    view: resolvedView,

    radius(metres: number): number {
      return resolvedView.radius * (1 + metres * relief)
    },

    write(target, offset, longitude, latitude, metres = 0): number {
      const radiusAtHeight = resolvedView.radius * (1 + metres * relief)
      const latitudeRadians = latitude * radians
      const longitudeRadians = longitude * radians + longitudeOffsetRadians
      const cosLatitude = Math.cos(latitudeRadians)
      target[offset] = radiusAtHeight * cosLatitude * Math.cos(longitudeRadians)
      target[offset + 1] = radiusAtHeight * Math.sin(latitudeRadians)
      // The minus sign matters. With +sin here, east runs anticlockwise and the
      // whole planet comes out MIRRORED — east on the left, like a map held up
      // to a window. Negating z flips the sphere round to the normal handedness,
      // with longitude increasing to the right.
      target[offset + 2] = -radiusAtHeight * cosLatitude * Math.sin(longitudeRadians)
      return radiusAtHeight
    },

    frame(target, offset, longitude, latitude): number {
      const latitudeRadians = latitude * radians
      const longitudeRadians = longitude * radians + longitudeOffsetRadians
      const cosLatitude = Math.cos(latitudeRadians)
      const sinLatitude = Math.sin(latitudeRadians)
      const cosLongitude = Math.cos(longitudeRadians)
      const sinLongitude = Math.sin(longitudeRadians)

      // up: the normal, which is where `write` puts the point with the radius
      // divided out — so a marker turned by this stands on the surface
      target[offset] = cosLatitude * cosLongitude
      target[offset + 1] = sinLatitude
      target[offset + 2] = -cosLatitude * sinLongitude

      // north: the derivative of the position with respect to latitude
      target[offset + 3] = -sinLatitude * cosLongitude
      target[offset + 4] = cosLatitude
      target[offset + 5] = sinLatitude * sinLongitude

      /* east: the derivative with respect to longitude. Both derivatives come out
         unit length, so nothing here needs normalising — except in name at the
         poles, where cos(latitude) is 0 and north collapses to whichever way
         longitude happened to point. It stays finite and the frame stays
         orthonormal: there is no north at the pole, and this is the honest
         answer, not a NaN. */
      target[offset + 6] = -sinLongitude
      target[offset + 7] = 0
      target[offset + 8] = -cosLongitude

      return offset + 9
    },

    spin(longitude: number): number {
      return longitude + resolvedView.longitudeOffset
    },
  }
}

/** Four numbers into `target` at `at` — x, y, z, w — the rotation that stands an
 *  asset built the `axes` way onto the surface at this frame's lon/lat. The one
 *  convention that carries across engines, and the only one a sphere has: every
 *  other way of saying "turn this" needs a renderer to agree with. */
export const toQuaternion = (
  target: Float32Array,
  offset: number,
  frame: Float32Array,
  frameOffset = 0,
  axes: Axes = 'y-up',
): number => {
  const upX = frame[frameOffset]
  const upY = frame[frameOffset + 1]
  const upZ = frame[frameOffset + 2]
  const northX = frame[frameOffset + 3]
  const northY = frame[frameOffset + 4]
  const northZ = frame[frameOffset + 5]
  const eastX = frame[frameOffset + 6]
  const eastY = frame[frameOffset + 7]
  const eastZ = frame[frameOffset + 8]

  /* Where each of the asset's own axes ends up in the world — local X, then Y,
     then Z. East is the x for both conventions, because east is the one a
     right-hand rule can keep on the right. */
  const xX = eastX
  const xY = eastY
  const xZ = eastZ
  const yX = axes === 'z-up' ? northX : upX
  const yY = axes === 'z-up' ? northY : upY
  const yZ = axes === 'z-up' ? northZ : upZ
  const zX = axes === 'z-up' ? upX : -northX
  const zY = axes === 'z-up' ? upY : -northY
  const zZ = axes === 'z-up' ? upZ : -northZ

  /* The matrix form of a rotation, read back into a quaternion. The four
     branches are the standard trick for staying accurate when the angle is
     near 180°, where the first one divides by almost nothing — and a marker at
     the south pole is exactly that: half a turn from upright. */
  const trace = xX + yY + zZ
  let x: number
  let y: number
  let z: number
  let w: number

  if (trace > 0) {
    const scale = 2 * Math.sqrt(trace + 1)
    w = 0.25 * scale
    x = (yZ - zY) / scale
    y = (zX - xZ) / scale
    z = (xY - yX) / scale
  } else if (xX > yY && xX > zZ) {
    const scale = 2 * Math.sqrt(1 + xX - yY - zZ)
    x = 0.25 * scale
    w = (yZ - zY) / scale
    y = (xY + yX) / scale
    z = (xZ + zX) / scale
  } else if (yY > zZ) {
    const scale = 2 * Math.sqrt(1 + yY - xX - zZ)
    y = 0.25 * scale
    w = (zX - xZ) / scale
    x = (xY + yX) / scale
    z = (yZ + zY) / scale
  } else {
    const scale = 2 * Math.sqrt(1 + zZ - xX - yY)
    z = 0.25 * scale
    w = (xY - yX) / scale
    x = (xZ + zX) / scale
    y = (yZ + zY) / scale
  }

  target[offset] = x
  target[offset + 1] = y
  target[offset + 2] = z
  target[offset + 3] = w
  return offset + 4
}

/* A sampler that reads a grid dataset, bilinearly. */
export const samplerFromGrid = (data: EarthGeoData): ElevationSampler => {
  const grid = data.grid
  if (!grid) throw new Error(`earthGeoData/${data.id}: not a grid, so it cannot be sampled`)

  const { width, height, columnZeroLon, longitudeSpan, latitudeSpan } = grid
  if (grid.rowZero !== 'north') {
    throw new Error(
      `earthGeoData/${data.id}: rowZero is "${grid.rowZero}"; this sampler reads row 0 as ` +
      'the north pole, exactly as buildGlobeSurface draws it',
    )
  }

  return (longitude: number, latitude: number): number => {
    /* The same arithmetic buildGlobeSurface uses to place a vertex — column 0 at
       `columnZeroLon`, one whole span over `width` columns — so an overlay draped
       with this lands on the surface it is drawn over. The two getting out of
       step is exactly how a coastline ends up 180° from the land it outlines. */
    let column = ((longitude - columnZeroLon) / longitudeSpan) * width
    let row = ((90 - latitude) / latitudeSpan) * (height - 1)

    // longitude is a circle and latitude is not: wrap one, clamp the other
    column -= Math.floor(column / width) * width
    if (column >= width) column = 0 // a longitude of exactly 180 after rounding
    row = row < 0 ? 0 : row > height - 1 ? height - 1 : row

    const columnBefore = Math.floor(column)
    const rowBefore = Math.floor(row)
    const columnAfter = columnBefore + 1 >= width ? 0 : columnBefore + 1
    const rowAfter = rowBefore + 1 >= height ? height - 1 : rowBefore + 1
    const columnFraction = column - columnBefore
    const rowFraction = row - rowBefore

    const top = data.at(columnBefore, rowBefore) * (1 - columnFraction)
      + data.at(columnAfter, rowBefore) * columnFraction
    const bottom = data.at(columnBefore, rowAfter) * (1 - columnFraction)
      + data.at(columnAfter, rowAfter) * columnFraction
    return top * (1 - rowFraction) + bottom * rowFraction
  }
}

/* A flat sampler for overlays that should not follow the terrain at all. */
export const flat: ElevationSampler = () => 0
