import type { EarthGeoData } from '../../dataset/container/index.js'
import { defaultLiftM, projector } from '../../projection/projector/index.js'
import type { BoundaryLines, BoundaryOptions } from './build.types.js'

/* A pair is drawn only when it leaves the ring: not the same point twice, and
   not a jump across the antimeridian, which a plane view would draw as a streak
   over the whole map. */
const isDrawnSegment = (
  longitudes: Float32Array,
  latitudes: Float32Array,
  fromIndex: number,
  toIndex: number,
): boolean => {
  if (longitudes[fromIndex] === longitudes[toIndex]
    && latitudes[fromIndex] === latitudes[toIndex]) return false
  return Math.abs(longitudes[toIndex] - longitudes[fromIndex]) <= 180
}

/* Every ring of every polygon, as one buffer of chords at a constant lift. */
export const buildBoundaries = (
  data: EarthGeoData,
  options: BoundaryOptions = {},
): BoundaryLines => {
  if (data.kind !== 'polygons') {
    throw new Error(
      `earthGeoData/${data.id}: kind is "${data.kind}", not polygons — there is no ring in it`,
    )
  }

  const project = projector(options.view)
  const liftM = options.liftM ?? defaultLiftM
  const longitudes = data.value('lon')
  const latitudes = data.value('lat')

  /* One point joins at most one segment, so this is the ceiling — written into
     once and trimmed, rather than counted and walked a second time. */
  const positions = new Float32Array(data.recordCount * 6)
  let writeOffset = 0

  for (const polygon of data.polygons) {
    for (const ring of polygon.rings) {
      for (let pointIndex = 0; pointIndex < ring.count; pointIndex++) {
        const fromIndex = ring.offset + pointIndex
        const toIndex = ring.offset + ((pointIndex + 1) % ring.count)
        if (!isDrawnSegment(longitudes, latitudes, fromIndex, toIndex)) continue

        /* Both ends at one height, so the segment is a chord and not two points
           on two different spheres. */
        project.write(positions, writeOffset, longitudes[fromIndex], latitudes[fromIndex], liftM)
        project.write(positions, writeOffset + 3, longitudes[toIndex], latitudes[toIndex], liftM)
        writeOffset += 6
      }
    }
  }

  return {
    kind: 'boundaries',
    positions: positions.subarray(0, writeOffset),
    segments: writeOffset / 6,
    view: project.view,
  }
}
