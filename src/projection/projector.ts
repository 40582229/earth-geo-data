import type { EarthGeoData } from '../dataset/container.js'

/* ════════════════════════════════════════════════════════════════════════════
   sphere — the one place that knows how lon/lat becomes xyz

   Every loader in this folder projects through here, and that is the whole
   reason the folder exists. A globe, its coastlines, its borders, its cities and
   its earthquakes are five different files with five different shapes — points,
   lines, polygons, grids — and if each one did its own trigonometry they would
   drift apart by a fraction of a degree and the coastline would float off the
   land it is supposed to outline.

   So the formula lives once:

     x =  r · cos(lat) · cos(lon)
     y =  r · sin(lat)              <- up is the pole axis
     z = -r · cos(lat) · sin(lon)   <- the minus sign is load-bearing

   and everything else asks it politely.

   `view.surface` chooses between two answers, and they live in the same file for
   exactly the reason the file exists:

     'sphere'  the globe — the default, and what every layer was built as.
     'plane'   the same grid laid out flat: a 2:1 map, 2·radius wide and radius
               deep, north at -z, east at +x, and the height still pushing up.

   Two shapes, one projector — because the coastline that must sit on the terrain
   is built by lines.ts and the terrain by globe.ts, and both hand their `view` to
   this function. So `{ view: { surface: 'plane' } }` moves the map *and*
   everything drawn on it. A separate flat builder would be a second place for
   them to disagree about where 0°E is, which is the bug this file prevents.

   The knobs, all in the same units as the scene:

     radius              how big it is. Sea level; on a plane, half the width.
     heightExaggeration  metres of relief per metre of real elevation. 1 is true
                         to life, and true to life is flat — the whole range of
                         relief is 16 km against a 6371 km radius, 0.25% of it.
     longitudeOffset     spins the sphere about its own axis, so you can put any
                         meridian in front of the camera. The poles are on the
                         axis, so spinning can never tip it over. A plane has no
                         far side to bring round, so it ignores this.
     surface             'sphere' (default) or 'plane'. See above.
   ════════════════════════════════════════════════════════════════════════════ */

/** Mean radius of the Earth in metres — the divisor that turns elevation into a
 *  fraction of the sphere. The real figure varies 6357 km (poles) to 6378 km
 *  (equator); a globe 0.3% out of round is not a globe anyone can see. */
export const EARTH_RADIUS_M = 6371000

/** Which shape a projection produces. */
export type Surface = 'sphere' | 'plane'

/** How the surface is placed in your scene. Passed to every loader. */
export type GlobeView = {
  /** Scene units at sea level — and, on a plane, half the width of the map. */
  radius: number
  /** Metres of relief per metre of elevation. 0 flattens it. */
  heightExaggeration: number
  /** Degrees of spin about the pole axis. A plane ignores it. */
  longitudeOffset: number
  /** 'sphere' for a globe, 'plane' for a flat 2:1 map. Default 'sphere'. */
  surface: Surface
}

/** The rotation lesson 06 uses: a globe of radius 6, relief at 30x, turned so
 *  that 0°E — Africa and Europe — faces the lesson's camera at (10.4, 5.8, 10.4).
 *
 *  This offset is coupled to that camera rather than to the data: the projector
 *  puts a vertex at `longitude + offset`, so -45 is the number that brings 0°E
 *  round to the front. What is *not* free is that the globe and its overlays must
 *  use the same one — a coastline at 0°E and a terrain cell at 0°E have to land on
 *  the same point of the sphere, which is the whole reason both go through
 *  projector(). Lesson 06 passes it explicitly; this is what everything else gets. */
export const DEFAULT_VIEW: GlobeView = {
  radius: 6,
  heightExaggeration: 30,
  longitudeOffset: -45,
  surface: 'sphere',
}

/* Overlays — coastlines, borders, cities — are drawn *over* the terrain, and the
   terrain is a surface, not a sphere. A river at sea level would be buried under
   the Andes if it were projected at radius, so overlay layers are pushed out by
   this much elevation first. It is in metres of elevation rather than scene
   units so the same number keeps working when you change the radius, and 500 m
   is about half a pixel at the default zoom: enough to clear the surface, not
   enough to see the gap. Set it to 0 for overlays you want lying flat on the
   sea, or pass a bigger number for a satellite-style exploded view. */
export const DEFAULT_LIFT_M = 500

/** Degrees → radians, once, so the hot loops are one multiply. */
const RADIANS = Math.PI / 180

/**
 * A projection, with the view's arithmetic done once instead of per vertex.
 *
 * `write` is the hot path: 1.3 million road vertices call it, so it takes the
 * output array and an offset and writes three numbers into it rather than
 * returning anything. Allocating a Vector3 per vertex would cost more than the
 * whole rest of the loader — the same reason the elevation ramp is baked into a
 * table rather than scanned.
 */
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
  /** Longitude after the view's spin, in degrees — for debugging, not for loops. */
  spin(longitude: number): number
}

export function projector(view: Partial<GlobeView> = {}): Projector {
  const full: GlobeView = { ...DEFAULT_VIEW, ...view }
  const relief = full.heightExaggeration / EARTH_RADIUS_M
  /* A plane has no far side to bring round, and turning a map would slide it out
     from under its own edge — the last column would wrap off the right and the
     first off the left. So the spin is zero on a plane, in `write` and in
     `spin()` alike; a debugging helper that reported a spin that was not applied
     would be worse than no helper. */
  const offset = full.surface === 'sphere' ? full.longitudeOffset * RADIANS : 0

  if (full.surface === 'plane') {
    /* One degree is the same number of scene units in both directions, and that
       is what makes 360° x 180° come out 2:1 rather than as a square: radius/180
       units per degree means the full turn is 2·radius wide and the pole-to-pole
       run is radius deep. Cells stay square in degrees, which is what an
       equirectangular map is — they still shrink in metres towards the poles, and
       fixing that is a different projection (x times cos(lat)) rather than a
       different number here. */
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
      const phi = latitude * RADIANS
      const lambda = longitude * RADIANS + offset
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

/**
 * A function that answers "how high is the ground here?" in metres.
 *
 * This is what lets an overlay follow the terrain instead of floating on a
 * perfect sphere. It is a plain function rather than a grid so a loader never
 * has to know whether the height came from a 1024-cell grid, a 7200-cell one, or
 * a formula you made up in the lesson.
 */
export type ElevationSampler = (longitude: number, latitude: number) => number

/**
 * A sampler that reads a grid dataset, bilinearly.
 *
 * Nearest-cell would make a coastline step in 5.6 km jumps at the 4096 grid,
 * which shows as a staircase on the horizon. Bilinear costs three more array
 * reads and removes it.
 *
 * Longitude wraps and latitude clamps, because a grid is a rectangle and the
 * Earth is not: 179.9°E and 179.9°W are 8 km apart, but they are the last column
 * and the first one, and past the poles there is nothing to sample at all.
 */
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

/**
 * A flat sampler for overlays that should not follow the terrain at all.
 *
 * The sky needs this: a constellation has no elevation, and asking a star
 * catalogue how high the ground is under it is not a question.
 */
export const FLAT: ElevationSampler = () => 0
