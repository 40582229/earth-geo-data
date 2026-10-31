import type { Color3 } from '../../colour/types.js'

/** How the land is painted. Everything has a default that looks like the Earth;
 *  the options are there so a caller can paint a different planet with the same
 *  two rasters. */
export type EarthColourOptions = {
  /** Blend land to ice where it is cold enough. Default true. Turn it off and
   *  every mountain is the colour of the ground at sea level beside it. */
  snow?: boolean
  /** Let the snow-and-ice class paint over the ocean, so sea ice and ice shelves
   *  are white instead of water. Default true — without it the Arctic is a hole
   *  in the ice cap, which is not what a satellite sees. */
  ice?: boolean
  /** What to paint below sea level. Default: the elevation ramp, which has the
   *  bathymetry in it. */
  ocean?: (metres: number) => Color3
  /** What to paint a land class. Default: the land-cover palette. */
  land?: (classId: number) => Color3
}
