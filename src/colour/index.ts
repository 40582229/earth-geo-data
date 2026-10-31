export type { Color3 } from './types.js'

export { elevationRamp, sampleRamp, elevationColor, srgbToLinear } from './ramp/index.js'
export type { RampAnchor } from './ramp/index.js'

export {
  landCover, waterClasses, snowClass,
  landCoverClass, landCoverColor, landCoverName, landCoverId,
} from './landcover/index.js'
export type { LandCoverClass } from './landcover/index.js'
