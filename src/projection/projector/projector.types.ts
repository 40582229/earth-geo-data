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
  write(target: Float32Array, offset: number, longitude: number, latitude: number, metres?: number): number
  spin(longitude: number): number
}

/* A function that answers "how high is the ground here?" in metres. */
export type ElevationSampler = (longitude: number, latitude: number) => number
