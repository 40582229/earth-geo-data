/** An rgb triple, each channel 0..1.
 *
 *  Every *table* in this package — the elevation ramp's anchors, anything a
 *  caller passes to `colourOf` — is written as sRGB, the numbers you would type
 *  into a colour picker. Anything that ends up in a vertex buffer is converted
 *  to linear light first by `srgbToLinear`, because that is the space light
 *  actually adds up in. See `ramp.ts` for why the difference is not cosmetic. */
export type Color3 = [number, number, number]
