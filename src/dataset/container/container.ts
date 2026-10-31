import type { DataSource, EarthGeoDataJson, FieldHeader, FieldType, GridHeader, LineTopology, PartHeader, PolygonHeader, RecordRun } from './container.types.js'

/* earthGeoData/1: a JSON envelope, one base64 typed array, and a table that
   turns raw values into units (raw * scale + offset). Everything here checks
   its own arithmetic and throws, because nothing downstream will. */

type NumericArray =
  | Int8Array | Uint8Array
  | Int16Array | Uint16Array
  | Int32Array | Uint32Array
  | Float32Array | Float64Array

type NumericArrayConstructor = {
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): NumericArray
}

const types: Record<FieldType, { size: number; array: NumericArrayConstructor }> = {
  int8:    { size: 1, array: Int8Array },
  uint8:   { size: 1, array: Uint8Array },
  int16:   { size: 2, array: Int16Array },
  uint16:  { size: 2, array: Uint16Array },
  int32:   { size: 4, array: Int32Array },
  uint32:  { size: 4, array: Uint32Array },
  float32: { size: 4, array: Float32Array },
  float64: { size: 8, array: Float64Array },
}

/* The format is little-endian; typed array views read the platform's order. */
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

export const formatId = 'earthGeoData/1'

/** Top-level keys the format defines. Everything else lands in `meta`. */
const envelopeKeys = new Set([
  'format', 'id', 'kind', 'topology', 'title', 'source',
  'byteLength', 'grid', 'recordCount', 'fields', 'parts', 'polygons', 'stats', 'data',
])

export const base64ToBytes = (base64: string, byteLength: number): Uint8Array => {
  const binary = atob(base64)
  if (binary.length !== byteLength) {
    throw new Error(
      `earthGeoData: base64 decodes to ${binary.length} bytes, the header says ` +
      `${byteLength}. The payload is not what the envelope describes.`,
    )
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export class EarthGeoData {
  readonly format: string = formatId
  readonly id: string
  readonly kind: EarthGeoDataJson['kind']
  readonly title: string
  readonly source: DataSource
  readonly byteLength: number
  readonly stats: Record<string, number>

  readonly bytes: Uint8Array

  readonly meta: Record<string, unknown>

  readonly grid: GridHeader | null
  readonly recordCount: number
  readonly topology: LineTopology | null
  readonly parts: readonly PartHeader[]
  readonly polygons: readonly PolygonHeader[]

  private readonly headers: Map<string, FieldHeader>
  private readonly rawViews = new Map<string, NumericArray>()
  private readonly scaledViews = new Map<string, Float32Array>()
  private gridValuesCache: Float32Array | null = null

  constructor(json: EarthGeoDataJson) {
    if (json.format !== formatId) {
      throw new Error(`earthGeoData: format "${json.format}" is not "${formatId}"`)
    }
    if (!littleEndian) {
      throw new Error('earthGeoData: this machine is big-endian; the format is little-endian')
    }

    this.id = json.id
    this.kind = json.kind
    this.title = json.title
    this.source = json.source
    this.byteLength = json.byteLength
    this.stats = json.stats ?? {}
    this.grid = json.grid ?? null
    this.recordCount = json.recordCount ?? 0
    this.topology = json.topology ?? null
    this.parts = json.parts ?? []
    this.polygons = json.polygons ?? []

    this.bytes = base64ToBytes(json.data, json.byteLength)

    this.meta = {}
    for (const [key, value] of Object.entries(json)) {
      if (!envelopeKeys.has(key)) this.meta[key] = value
    }

    this.headers = new Map((json.fields ?? []).map((field) => [field.name, field]))

    this.check()
  }

  private check(): void {
    const { kind, byteLength } = this
    const fail = (message: string): never => {
      throw new Error(`earthGeoData/${this.id}: ${message}`)
    }

    if (kind === 'grid') {
      const grid = this.grid ?? fail('kind is "grid" but there is no grid header')
      const type = types[grid.type] ?? fail(`grid type "${grid.type}" is not a type`)

      if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) ||
          grid.width < 2 || grid.height < 2) {
        fail(`grid is ${grid.width}x${grid.height}; both sides need to be at least 2`)
      }
      const expected = grid.width * grid.height * type.size
      if (byteLength !== expected) {
        fail(
          `grid is ${grid.width}x${grid.height} ${grid.type}, which is ${expected} bytes, ` +
          `but the payload is ${byteLength}`,
        )
      }
      if (grid.nodata !== null && grid.type !== 'float32' && grid.type !== 'float64') {
        const bits = type.size * 8
        const unsigned = grid.type.startsWith('u')
        const lowestValue = unsigned ? 0 : -Math.pow(2, bits - 1)
        const highestValue = unsigned ? Math.pow(2, bits) - 1 : Math.pow(2, bits - 1) - 1
        if (!Number.isInteger(grid.nodata)
          || grid.nodata < lowestValue || grid.nodata > highestValue) {
          fail(`nodata ${grid.nodata} cannot be stored in ${grid.type} `
            + `(${lowestValue}..${highestValue})`)
        }
      }
      return
    }

    const fields = [...this.headers.values()]
    if (!fields.length) fail('no fields')

    let expectedEnd = 0
    for (const field of fields) {
      const type = types[field.type] ?? fail(`field "${field.name}" type "${field.type}" is not a type`)

      if (field.byteOffset % type.size !== 0) {
        fail(
          `field "${field.name}" starts at byte ${field.byteOffset}, which is not a multiple of ` +
          `${type.size}. A ${field.type} view cannot start there.`,
        )
      }
      if (field.count !== this.recordCount) {
        fail(
          `field "${field.name}" has ${field.count} values but there are ` +
          `${this.recordCount} records. Every field is one value per record.`,
        )
      }
      const end = field.byteOffset + field.count * type.size
      if (end > byteLength) {
        fail(`field "${field.name}" runs to byte ${end}, past the ${byteLength}-byte payload`)
      }
      if (field.byteOffset < expectedEnd) {
        fail(`field "${field.name}" starts at ${field.byteOffset}, inside the previous field`)
      }
      expectedEnd = end
    }

    if (expectedEnd !== byteLength) {
      fail(
        `the fields account for ${expectedEnd} bytes but the payload is ${byteLength}; ` +
        `${byteLength - expectedEnd} bytes are unaccounted for`,
      )
    }

    if (kind === 'polygons') {
      if (!this.polygons.length) fail('kind is "polygons" but there are no polygons')
      for (const polygon of this.polygons) {
        if (!polygon.rings.length) fail(`polygon "${polygon.name}" has no rings`)
        if (!polygon.rings.some((ring) => ring.role === 'outer')) {
          fail(`polygon "${polygon.name}" has no outer ring, only holes`)
        }
        for (const ring of polygon.rings) {
          if (ring.count < 4) {
            fail(`polygon "${polygon.name}" has a ${ring.count}-record ring; a closed ring needs 4`)
          }
          if (ring.offset + ring.count > this.recordCount) {
            fail(`polygon "${polygon.name}" has a ring running past the end of the records`)
          }
        }
      }
      this.checkTiling(
        this.polygons.flatMap((polygon) => polygon.rings),
        'rings',
      )
      return
    }

    if (kind === 'points') {
      if (this.parts.length) this.checkTiling(this.parts, 'parts')
      return
    }

    if (this.topology !== 'polyline' && this.topology !== 'segments') {
      fail(`kind is "lines" but topology is ${JSON.stringify(this.topology)}; it must be "polyline" or "segments"`)
    }

    if (this.topology === 'polyline') {
      if (!this.parts.length) fail('a polyline needs parts saying where each path starts and ends')
      for (const part of this.parts) {
        if (part.count < 2) fail(`line part "${part.name}" has ${part.count} record(s); a line needs 2`)
      }
    } else {
      if (this.recordCount < 2 || this.recordCount % 2 !== 0) {
        fail(
          `topology "segments" takes records in pairs, but there are ${this.recordCount}. ` +
          'An odd count means one vertex is left over and half the last segment is wrong.',
        )
      }
      for (const part of this.parts) {
        if (part.count % 2 !== 0) {
          fail(`segment part "${part.name}" has ${part.count} records; pairs need an even count`)
        }
      }
    }

    if (this.parts.length) this.checkTiling(this.parts, 'parts')
  }

  private checkTiling(runs: readonly RecordRun[], what: string): void {
    const sorted = [...runs].sort((left, right) => left.offset - right.offset)
    let cursor = 0
    for (const run of sorted) {
      if (run.offset !== cursor) {
        throw new Error(
          `earthGeoData/${this.id}: ${what} skip from record ${cursor} to ${run.offset}; ` +
          `${run.offset - cursor} record(s) belong to nothing`,
        )
      }
      cursor = run.offset + run.count
    }
    if (cursor !== this.recordCount) {
      throw new Error(
        `earthGeoData/${this.id}: ${what} end at record ${cursor} but there are ` +
        `${this.recordCount} records`,
      )
    }
  }

  field(name: string): NumericArray {
    const cached = this.rawViews.get(name)
    if (cached) return cached

    const header = this.headers.get(name)
    if (!header) {
      throw new Error(
        `earthGeoData/${this.id}: no field "${name}". It has: ` +
        `${[...this.headers.keys()].join(', ')}`,
      )
    }
    const type = types[header.type]
    const view = new type.array(this.bytes.buffer, this.bytes.byteOffset + header.byteOffset, header.count)
    this.rawViews.set(name, view)
    return view
  }

  value(name: string): Float32Array {
    const cached = this.scaledViews.get(name)
    if (cached) return cached

    const header = this.headers.get(name)
    if (!header) this.field(name) // throws with the field list

    const fieldHeader = header as FieldHeader
    const raw = this.field(name)
    if (fieldHeader.type === 'float32' && fieldHeader.scale === 1 && fieldHeader.offset === 0) {
      const alreadyScaled = raw as Float32Array
      this.scaledViews.set(name, alreadyScaled)
      return alreadyScaled
    }

    const scaled = new Float32Array(raw.length)
    for (let index = 0; index < raw.length; index++) {
      scaled[index] = raw[index] * fieldHeader.scale + fieldHeader.offset
    }
    this.scaledViews.set(name, scaled)
    return scaled
  }

  get fieldNames(): string[] {
    return [...this.headers.keys()]
  }

  private gridHeader(): GridHeader {
    if (!this.grid) throw new Error(`earthGeoData/${this.id}: not a grid`)
    return this.grid
  }

  private gridView(): NumericArray {
    if (!this.gridRawView) {
      const grid = this.gridHeader()
      const type = types[grid.type]
      this.gridRawView = new type.array(
        this.bytes.buffer, this.bytes.byteOffset, grid.width * grid.height,
      )
    }
    return this.gridRawView
  }
  private gridRawView: NumericArray | null = null

  gridRaw(): NumericArray {
    this.gridHeader()
    return this.gridView()
  }

  rawAt(column: number, row: number): number {
    const grid = this.gridHeader()
    this.checkCell(column, row, grid)
    return this.gridView()[row * grid.width + column]
  }

  at(column: number, row: number): number {
    const grid = this.gridHeader()
    return this.rawAt(column, row) * grid.scale + grid.offset
  }

  isNoData(column: number, row: number): boolean {
    const grid = this.gridHeader()
    return grid.nodata !== null && this.rawAt(column, row) === grid.nodata
  }

  private checkCell(column: number, row: number, grid: GridHeader): void {
    if (column < 0 || column >= grid.width || row < 0 || row >= grid.height) {
      throw new Error(
        `earthGeoData/${this.id}: cell (${column}, ${row}) is outside the ` +
        `${grid.width}x${grid.height} grid`,
      )
    }
  }

  longitudeAt(column: number): number {
    const grid = this.gridHeader()
    return grid.columnZeroLon + (column / grid.width) * grid.longitudeSpan
  }

  latitudeAt(row: number): number {
    const grid = this.gridHeader()
    return 90 - (row / (grid.height - 1)) * grid.latitudeSpan
  }

  gridValues(): Float32Array {
    if (this.gridValuesCache) return this.gridValuesCache

    const grid = this.gridHeader()
    const raw = this.gridView()
    const scaled = new Float32Array(raw.length)
    for (let index = 0; index < raw.length; index++) {
      scaled[index] = raw[index] * grid.scale + grid.offset
    }
    this.gridValuesCache = scaled
    return scaled
  }

  get range(): { min: number; max: number } | null {
    return 'min' in this.stats && 'max' in this.stats
      ? { min: this.stats.min, max: this.stats.max }
      : null
  }

  get credit(): string {
    return `${this.title} — ${this.source.attribution} (${this.source.licence})`
  }
}

export const parseEarthGeoData = (json: EarthGeoDataJson): EarthGeoData => {
  return new EarthGeoData(json)
}
