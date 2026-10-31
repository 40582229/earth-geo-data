import type { Color3 } from '../types.js'

/** One step of the elevation ramp: a height in metres and the colour there. */
export type RampAnchor = {
  metres: number
  rgb: Color3
}
