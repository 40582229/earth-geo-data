/* ════════════════════════════════════════════════════════════════════════════
   earthGeoData.ts — one decoder for every dataset in public/data/earthGeoData/

   The format is `earthGeoData/1`, and this file is its reference implementation.

   Everything in that folder — elevation grids, plate boundaries, volcanoes,
   stars, buildings — arrives as the same thing:

       JSON envelope  +  one base64 blob  +  a table saying how to read it

   The blob is always a typed array. The table always ends up as
   `raw * scale + offset`. And the envelope's `kind` says what the numbers are:
   grid -> a surface, points -> vertices, lines -> line segments, polygons ->
   filled triangles.

   So there is exactly one thing to learn here: bytes go into a typed array, the
   typed array becomes a buffer, and the shape decides how it is drawn.

   WHY THIS FILE IS SO PARANOID
     Nothing downstream checks anything. Hand a renderer a Float32Array that is
     one element too short and it draws garbage, or nothing, with no error.

     A base64 payload that decodes to the wrong number of bytes is the same
     class of mistake, and it happens at *build* time, where you cannot see it.
     So this decoder checks its own arithmetic and throws. The failures it
     catches are the ones that would otherwise show up as "the globe looks a
     bit wrong" three hours later.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── the type table ─────────────────────────────────────────────────────────
   Every scalar type the format allows, with its byte size and the typed array
   that views it. `size` is what makes byteOffset arithmetic checkable. */

export type FieldType =
  | 'int8' | 'uint8'
  | 'int16' | 'uint16'
  | 'int32' | 'uint32'
  | 'float32' | 'float64'

type NumericArray =
  | Int8Array | Uint8Array
  | Int16Array | Uint16Array
  | Int32Array | Uint32Array
  | Float32Array | Float64Array

type NumericArrayConstructor = {
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): NumericArray
}

const TYPES: Record<FieldType, { size: number; array: NumericArrayConstructor }> = {
  int8:    { size: 1, array: Int8Array },
  uint8:   { size: 1, array: Uint8Array },
  int16:   { size: 2, array: Int16Array },
  uint16:  { size: 2, array: Uint16Array },
  int32:   { size: 4, array: Int32Array },
  uint32:  { size: 4, array: Uint32Array },
  float32: { size: 4, array: Float32Array },
  float64: { size: 8, array: Float64Array },
}

/* Typed array views read the buffer in the *platform's* byte order. The format
   is little-endian, which is every platform this runs on — but "every platform
   I know of" is not a guarantee, and a big-endian machine would decode every
   number as byte-swapped nonsense with no error at all. So check once. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

/* ── the shape of the JSON on disk ─────────────────────────────────────────── */

/** Where a dataset came from. Travels with the data because three of the four
 *  licences in this library legally require attribution. */
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
  /** Byte offset of this field's first byte inside the decoded payload. */
  byteOffset: number
  count: number
  /** value = raw * scale + offset. 1 and 0 mean the raw numbers are the values. */
  scale: number
  offset: number
  unit?: string
}

/** A run of records: one polyline for `lines`, one named group for `points`. */
export type PartHeader = {
  name: string
  offset: number
  count: number
  /** The last record repeats the first, so do not close it again. */
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
  /** Stored as the raw integer — compare against `raw`, not the scaled value. */
  nodata: number | null
}

export type EarthGeoDataJson = {
  format: string
  id: string
  kind: 'grid' | 'points' | 'lines' | 'polygons'
  /** For kind "lines" only. "polyline" is one connected path per part;
   *  "segments" takes records in pairs, each pair its own segment. */
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

/** Which line shape the records describe. */
export type LineTopology = 'polyline' | 'segments'

export const FORMAT = 'earthGeoData/1'

/** Top-level keys the format defines. Everything else lands in `meta`. */
const ENVELOPE_KEYS = new Set([
  'format', 'id', 'kind', 'topology', 'title', 'source',
  'byteLength', 'grid', 'recordCount', 'fields', 'parts', 'polygons', 'stats', 'data',
])

/* ── base64 ─────────────────────────────────────────────────────────────────
   Two steps:

     1. atob() gives a *string* with one character per byte. It is not a byte
        array, however much it looks like one.
     2. charCodeAt() turns each character into 0-255 so a typed array can hold
        it. Skipping this and reading the string directly is the classic bug.

   Then the bytes become numbers through a typed array *view* — no parsing, no
   JSON numbers, just the same bytes reinterpreted. */
export function base64ToBytes(base64: string, byteLength: number): Uint8Array {
  const binary = atob(base64)
  if (binary.length !== byteLength) {
    throw new Error(
      `earthGeoData: base64 decodes to ${binary.length} bytes, the header says ` +
      `${byteLength}. The payload is not what the envelope describes.`,
    )
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/* ── the decoded dataset ───────────────────────────────────────────────────── */

export class EarthGeoData {
  /** Always `earthGeoData/1`. Present on the instance so a consumer can branch
   *  on the version of something it was handed. */
  readonly format: string = FORMAT
  readonly id: string
  readonly kind: EarthGeoDataJson['kind']
  readonly title: string
  readonly source: DataSource
  readonly byteLength: number
  readonly stats: Record<string, number>

  /** The decoded payload. Every field is a view onto this one buffer. */
  readonly bytes: Uint8Array

  /**
   * Whatever else the dataset brought: contour levels, the magnitude cut of a
   * star catalogue, the class tiers of a road network.
   *
   * Anything at the top level of the file that is not one of the keys this
   * format defines. Keeping it means a converter can attach what it needs
   * without the format growing a field per dataset — and the structural checks
   * below cannot be confused by it, because they only look at known keys.
   */
  readonly meta: Record<string, unknown>

  readonly grid: GridHeader | null
  readonly recordCount: number
  /**
   * For `kind: "lines"`, which of the two line shapes the records describe:
   *
   *   "polyline" -> connected     records join up into paths, use `parts`
   *   "segments" -> separate      records come in pairs, ignore `parts` for
   *                               connectivity (they are named subsets)
   *
   * Null for every other kind.
   */
  readonly topology: LineTopology | null
  readonly parts: readonly PartHeader[]
  readonly polygons: readonly PolygonHeader[]

  private readonly headers: Map<string, FieldHeader>
  private readonly rawViews = new Map<string, NumericArray>()
  private readonly scaledViews = new Map<string, Float32Array>()
  private gridValuesCache: Float32Array | null = null

  constructor(json: EarthGeoDataJson) {
    if (json.format !== FORMAT) {
      throw new Error(`earthGeoData: format "${json.format}" is not "${FORMAT}"`)
    }
    if (!LITTLE_ENDIAN) {
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
      if (!ENVELOPE_KEYS.has(key)) this.meta[key] = value
    }

    this.headers = new Map((json.fields ?? []).map((field) => [field.name, field]))

    this.check()
  }

  /* ── the checks ───────────────────────────────────────────────────────────
     Every one of these is a mistake that would otherwise reach the GPU. */
  private check(): void {
    const { kind, byteLength } = this
    const fail = (message: string): never => {
      throw new Error(`earthGeoData/${this.id}: ${message}`)
    }

    if (kind === 'grid') {
      const grid = this.grid ?? fail('kind is "grid" but there is no grid header')
      const type = TYPES[grid.type] ?? fail(`grid type "${grid.type}" is not a type`)

      if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) ||
          grid.width < 2 || grid.height < 2) {
        fail(`grid is ${grid.width}x${grid.height}; both sides need to be at least 2`)
      }
      /* The one number that matters: a grid one row short still decodes, still
         builds a mesh, and is wrong everywhere past the missing row. */
      const expected = grid.width * grid.height * type.size
      if (byteLength !== expected) {
        fail(
          `grid is ${grid.width}x${grid.height} ${grid.type}, which is ${expected} bytes, ` +
          `but the payload is ${byteLength}`,
        )
      }
      /* nodata is stored in raw space, so it has to be representable in the raw
         type or it can never match a cell and the marker silently does nothing. */
      if (grid.nodata !== null && grid.type !== 'float32' && grid.type !== 'float64') {
        const bits = type.size * 8
        const unsigned = grid.type.startsWith('u')
        const low = unsigned ? 0 : -Math.pow(2, bits - 1)
        const high = unsigned ? Math.pow(2, bits) - 1 : Math.pow(2, bits - 1) - 1
        if (!Number.isInteger(grid.nodata) || grid.nodata < low || grid.nodata > high) {
          fail(`nodata ${grid.nodata} cannot be stored in ${grid.type} (${low}..${high})`)
        }
      }
      return
    }

    /* points / lines / polygons: fields, then the grouping over them. */
    const fields = [...this.headers.values()]
    if (!fields.length) fail('no fields')

    let expectedEnd = 0
    for (const field of fields) {
      const type = TYPES[field.type] ?? fail(`field "${field.name}" type "${field.type}" is not a type`)

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

    /* No slack. This is what catches a payload written from the wrong array —
       the file still loads, the first field still reads correctly, and only the
       end of the last field is quietly from somewhere else. */
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
        /* A polygon with only holes is a shape drawn inside-out — the fill has
           nothing to fill and earcut silently returns no triangles. */
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

    /* lines. Which of the two line shapes this is decides what a valid buffer
       looks like, so it is checked before anything else. */
    if (this.topology !== 'polyline' && this.topology !== 'segments') {
      fail(`kind is "lines" but topology is ${JSON.stringify(this.topology)}; it must be "polyline" or "segments"`)
    }

    if (this.topology === 'polyline') {
      /* A polyline part with one record has no segments: it draws nothing, and
         it is almost always a converter that lost a shape. */
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

  /** Parts (or rings) must cover the record array exactly: no gaps, no overlaps. */
  private checkTiling(runs: readonly { offset: number; count: number }[], what: string): void {
    const sorted = [...runs].sort((a, b) => a.offset - b.offset)
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

  /* ── reading the numbers ───────────────────────────────────────────────── */

  /**
   * The raw quantised values of one field, as stored.
   *
   * This is a *view*, not a copy: it shares memory with `bytes`. For a uint16
   * longitude that is half the memory of the decoded degrees, which is the
   * whole reason the data is stored that way.
   */
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
    const type = TYPES[header.type]
    const view = new type.array(this.bytes.buffer, this.bytes.byteOffset + header.byteOffset, header.count)
    this.rawViews.set(name, view)
    return view
  }

  /**
   * The same field with `scale` and `offset` applied: the numbers you actually
   * want, as Float32Array.
   *
   * A float32 field stored with no scaling is handed back as-is rather than
   * copied — it is already exactly the array a vertex buffer wants.
   */
  value(name: string): Float32Array {
    const cached = this.scaledViews.get(name)
    if (cached) return cached

    const header = this.headers.get(name)
    if (!header) this.field(name) // throws with the field list

    const spec = header as FieldHeader
    const raw = this.field(name)
    if (spec.type === 'float32' && spec.scale === 1 && spec.offset === 0) {
      const direct = raw as Float32Array
      this.scaledViews.set(name, direct)
      return direct
    }

    const out = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] * spec.scale + spec.offset
    this.scaledViews.set(name, out)
    return out
  }

  /** Field names, in the order they were declared. */
  get fieldNames(): string[] {
    return [...this.headers.keys()]
  }

  /* ── grids ─────────────────────────────────────────────────────────────── */

  private gridHeader(): GridHeader {
    if (!this.grid) throw new Error(`earthGeoData/${this.id}: not a grid`)
    return this.grid
  }

  private gridView(): NumericArray {
    if (!this.gridRawView) {
      const grid = this.gridHeader()
      const type = TYPES[grid.type]
      this.gridRawView = new type.array(
        this.bytes.buffer, this.bytes.byteOffset, grid.width * grid.height,
      )
    }
    return this.gridRawView
  }
  private gridRawView: NumericArray | null = null

  /**
   * The whole grid as stored — the raw integers, no scaling, no copy.
   *
   * This is the cheapest way to look at a big grid: 16 MB of int16 stays 16 MB
   * instead of becoming 32 MB of float32, and it is the array a
   * vertex buffer could take directly if the encoding happens to suit.
   */
  gridRaw(): NumericArray {
    this.gridHeader()
    return this.gridView()
  }

  /** The stored integer at a cell, with no scaling applied. */
  rawAt(column: number, row: number): number {
    const grid = this.gridHeader()
    this.checkCell(column, row, grid)
    return this.gridView()[row * grid.width + column]
  }

  /** The value at a cell in the grid's own unit — metres, for elevation. */
  at(column: number, row: number): number {
    const grid = this.gridHeader()
    return this.rawAt(column, row) * grid.scale + grid.offset
  }

  /** True where the cell holds the format's nodata marker. */
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

  /** Longitude of a column, in degrees. Column 0 is `columnZeroLon`, and the
   *  columns run one whole span over `width` of them — so the last column is one
   *  step short of `columnZeroLon + longitudeSpan`, and it is the *seam* that
   *  closes the turn, not a repeat of the first column.
   *
   *  This is measured rather than assumed: draping a coastline over
   *  etopo/terrain finds a clean minimum at `width` and at no other divisor
   *  (32.8 / 26.8 / **26.1** / 32.2 / 38.0 m median for 4094 … 4098), and the
   *  same at 1024 (99.9 / 61.6 / **44.8** / 63.7 / 86.0). An earlier version of
   *  this file said `width - 1`. */
  longitudeAt(column: number): number {
    const grid = this.gridHeader()
    return grid.columnZeroLon + (column / grid.width) * grid.longitudeSpan
  }

  /** Latitude of a row, in degrees. Row 0 is the north pole. */
  latitudeAt(row: number): number {
    const grid = this.gridHeader()
    return 90 - (row / (grid.height - 1)) * grid.latitudeSpan
  }

  /**
   * The whole grid as Float32, scaled.
   *
   * Allocates: a 4096x2048 int16 grid is 16 MB stored and 32 MB as float32, so
   * prefer `at()` when you are sampling rather than meshing.
   */
  gridValues(): Float32Array {
    if (this.gridValuesCache) return this.gridValuesCache

    const grid = this.gridHeader()
    const raw = this.gridView()
    const out = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] * grid.scale + grid.offset
    this.gridValuesCache = out
    return out
  }

  /** The min/max the converter measured, so you can check without a full scan. */
  get range(): { min: number; max: number } | null {
    return 'min' in this.stats && 'max' in this.stats
      ? { min: this.stats.min, max: this.stats.max }
      : null
  }

  /** One line naming the dataset and its licence — print this in any UI that
   *  shows the data, because the licences that require attribution mean it. */
  get credit(): string {
    return `${this.title} — ${this.source.attribution} (${this.source.licence})`
  }
}

/* ── the manifest ───────────────────────────────────────────────────────────
   There is no directory listing over HTTP, so without an index a consumer has to
   know every filename in advance — which is exactly the coupling this library
   exists to remove. index.json is generated by tools/earthgeodata/convert/index.mjs
   and lists every dataset with its shape, its size, its licence and its hash. */

export type EarthGeoDataIndexEntry = {
  id: string
  /** Relative to the earthGeoData root. */
  path: string
  kind: EarthGeoDataJson['kind']
  title: string
  topology?: LineTopology
  width?: number
  height?: number
  unit?: string
  records?: number
  /** Size of the JSON file on disk. */
  bytes: number
  /** Size of the payload after base64 decoding. */
  sourceBytes: number
  /** SHA-256 of the file, hex. Verify a download against this. */
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

/* ── parsing ───────────────────────────────────────────────────────────────── */

/**
 * Parse an envelope you already have the text of.
 *
 * Reading the bytes — from disk in Node, over the network in a browser — lives
 * in `../source`, so this file stays a pure function of the JSON it is handed
 * and can be tested without touching a filesystem at all.
 */
export function parseEarthGeoData(json: EarthGeoDataJson): EarthGeoData {
  return new EarthGeoData(json)
}
