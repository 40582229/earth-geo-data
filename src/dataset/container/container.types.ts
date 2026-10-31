export type FieldType =
  | 'int8' | 'uint8'
  | 'int16' | 'uint16'
  | 'int32' | 'uint32'
  | 'float32' | 'float64'

/** How a stored value becomes a measurement: `raw * scale + offset`. */
export type FieldEncoding = {
  type: FieldType
  scale: number
  offset: number
}

/** A run of records: `count` of them, starting at record `offset`. */
export type RecordRun = {
  offset: number
  count: number
}

/** How many columns and how many rows a grid has. */
export type GridShape = {
  width: number
  height: number
}

/** Who to credit for a dataset and when it was fetched; the manifest copies it. */
export type SourceCredit = {
  licence: string
  attribution: string
  retrieved: string
}

export type DataSource = SourceCredit & {
  name: string
  url: string
}

/** One column of the payload: a flat typed array of `count` values. */
export type FieldHeader = FieldEncoding & {
  name: string
  byteOffset: number
  count: number
  unit?: string
}

/** What the manifest says about a field: enough to label it, not to read it. */
export type FieldSummary = Pick<FieldHeader, 'name' | 'type'> & {
  unit: string | null
}

/** A run of records: one polyline for `lines`, one named group for `points`. */
export type PartHeader = RecordRun & {
  name: string
  closed?: boolean
}

/** A ring inside a polygon. `role` is what tells a fill where the holes are. */
export type RingHeader = RecordRun & {
  role: 'outer' | 'hole'
}

export type PolygonHeader = {
  name: string
  rings: RingHeader[]
}

export type GridHeader = GridShape & FieldEncoding & {
  layout: 'equirectangular'
  rowZero: 'north'
  columnZeroLon: number
  longitudeSpan: number
  latitudeSpan: number
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

export type EarthGeoDataIndexEntry = SourceCredit & Partial<GridShape> & {
  id: string
  path: string
  kind: EarthGeoDataJson['kind']
  title: string
  topology?: LineTopology
  unit?: string
  records?: number
  bytes: number
  sourceBytes: number
  sha256: string
  fields?: FieldSummary[]
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
