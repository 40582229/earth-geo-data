import type { EarthGeoData } from '../dataset/container.js'

/* lon/lat -> xyz, once, so no two layers can disagree about where anything is:

     x =  r·cos(lat)·cos(lon)
     y =  r·sin(lat)
     z = -r·cos(lat)·sin(lon)

   'plane' lays the same grid out flat instead: 2·radius wide, radius deep. */

/** Mean radius of the Earth in metres — the divisor that turns elevation into a
 *  fraction of the sphere. The real figure varies 6357 km (poles) to 6378 km
 *  (equator); a globe 0.3% out of round is not a globe anyone can see. */
export const earthRadiusM = 6371000

/** Which shape a projection produces. */
export type Surface = 'sphere' | 'plane'

/** How the surface is placed in your scene. Passed to every loader. */
export type GlobeView = {
  radius: number
  heightExaggeration: number
  longitudeOffset: number
  /** 'sphere' for a globe, 'plane' for a flat 2:1 map. Default 'sphere'. */
  surface: Surface
}

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

/* A projection, with the view's arithmetic done once instead of per vertex. */
export type Projector = {
  readonly view: GlobeView
  /** How far out the projection pushes a point at this elevation, in scene
   *  units — distance from the centre on a sphere, height above the plane on a
   *  plane. Negative below sea level, which is honest: a trench is below it. */
  radius(metres: number): number
  /** Write the xyz of one lon/lat into `out` at `at`, `at+1`, `at+2`, and hand
   *  back the radius it used — so a caller can measure the band it produced
   *  without a second pass over the vertices with a hypot() each. */
  write(out: Float32Array, at: number, longitude: number, latitude: number, metres?: number): number
  spin(longitude: number): number
}

export function projector(view: Partial<GlobeView> = {}): Projector {
  const full: GlobeView = { ...defaultView, ...view }
  const relief = full.heightExaggeration / earthRadiusM
  const offset = full.surface === 'sphere' ? full.longitudeOffset * radians : 0

  if (full.surface === 'plane') {
    const perDegree = full.radius / 180
    /* The same metres-to-units factor the sphere uses, deliberately: switching a
       layer between sphere and plane is then a change of shape and not a change
       of scale, and the Andes are the same height in both. */
    const perMetre = full.radius * relief

    return {
      view: full,

      radius(metres: number): number {
        return metres * perMetre
      },

      write(out, at, longitude, latitude, metres = 0): number {
        const y = metres * perMetre
        out[at] = longitude * perDegree
        out[at + 1] = y
        // north at -z, so a camera above the map with -z up sees north at the
        // top and east to the right — the same way round as the globe, which is
        // why an overlay needs no special case. It also leaves the triangles
        // facing +y with the index order globe.ts already writes.
        out[at + 2] = -latitude * perDegree
        return y
      },

      spin(longitude: number): number {
        return longitude
      },
    }
  }

  return {
    view: full,

    radius(metres: number): number {
      return full.radius * (1 + metres * relief)
    },

    write(out, at, longitude, latitude, metres = 0): number {
      const r = full.radius * (1 + metres * relief)
      const phi = latitude * radians
      const lambda = longitude * radians + offset
      const cosPhi = Math.cos(phi)
      out[at] = r * cosPhi * Math.cos(lambda)
      out[at + 1] = r * Math.sin(phi)
      // The minus sign matters. With +sin here, east runs anticlockwise and the
      // whole planet comes out MIRRORED — east on the left, like a map held up
      // to a window. Negating z flips the sphere round to the normal handedness,
      // with longitude increasing to the right.
      out[at + 2] = -r * cosPhi * Math.sin(lambda)
      return r
    },

    spin(longitude: number): number {
      return longitude + full.longitudeOffset
    },
  }
}

/* A function that answers "how high is the ground here?" in metres. */
export type ElevationSampler = (longitude: number, latitude: number) => number

/* A sampler that reads a grid dataset, bilinearly. */
export function samplerFromGrid(data: EarthGeoData): ElevationSampler {
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

    const c0 = Math.floor(column)
    const r0 = Math.floor(row)
    const c1 = c0 + 1 >= width ? 0 : c0 + 1 // wrap east to west, it is the same meridian
    const r1 = r0 + 1 >= height ? height - 1 : r0 + 1
    const tx = column - c0
    const ty = row - r0

    const top = data.at(c0, r0) * (1 - tx) + data.at(c1, r0) * tx
    const bottom = data.at(c0, r1) * (1 - tx) + data.at(c1, r1) * tx
    return top * (1 - ty) + bottom * ty
  }
}

/* A flat sampler for overlays that should not follow the terrain at all. */
export const flat: ElevationSampler = () => 0
