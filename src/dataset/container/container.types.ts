export type FieldType =
  | 'int8' | 'uint8'
  | 'int16' | 'uint16'
  | 'int32' | 'uint32'
  | 'float32' | 'float64'

export type DataSource = {
  name: string
  url: string
  licence: string
  attribution: string
  retrieved: string
}

/** One column of the payload: a flat typed array of `count` values. */
export type FieldHeader = {
  name: string
  type: FieldType
  byteOffset: number
  count: number
  scale: number
  offset: number
  unit?: string
}

/** A run of records: one polyline for `lines`, one named group for `points`. */
export type PartHeader = {
  name: string
  offset: number
  count: number
  closed?: boolean
}

/** A ring inside a polygon. `role` is what tells a fill where the holes are. */
export type RingHeader = {
  offset: number
  count: number
  role: 'outer' | 'hole'
}

export type PolygonHeader = {
  name: string
  rings: RingHeader[]
}

export type GridHeader = {
  width: number
  height: number
  layout: 'equirectangular'
  rowZero: 'north'
  columnZeroLon: number
  longitudeSpan: number
  latitudeSpan: number
  type: FieldType
  scale: number
  offset: number
  unit: string
  nodata: number | null
}

export type EarthGeoDataJson = {
  format: string
  id: string
  kind: 'grid' | 'points' | 'lines' | 'polygons'
  topology?: LineTopology
  title: string
  source: DataSource
  byteLength: number
  grid?: GridHeader
  recordCount?: number
  fields?: FieldHeader[]
  parts?: PartHeader[]
  polygons?: PolygonHeader[]
  stats?: Record<string, number>
  data: string
}

export type LineTopology = 'polyline' | 'segments'

export type EarthGeoDataIndexEntry = {
  id: string
  path: string
  kind: EarthGeoDataJson['kind']
  title: string
  topology?: LineTopology
  width?: number
  height?: number
  unit?: string
  records?: number
  bytes: number
  sourceBytes: number
  sha256: string
  licence: string
  attribution: string
  retrieved: string
  fields?: { name: string; type: FieldType; unit: string | null }[]
  stats?: Record<string, number>
  band?: string
  magnitudeLimit?: number
}

export type EarthGeoDataIndex = {
  format: string
  generated: string
  root: string
  totals: { datasets: number; bytes: number; megabytes: number; records: number }
  licences: Record<string, string[]>
  byKind: Record<string, number>
  datasets: EarthGeoDataIndexEntry[]
}
