import type {
  EarthGeoData,
  EarthGeoDataIndex,
  EarthGeoDataIndexEntry,
  EarthGeoDataJson,
} from '../dataset/container.js'
import { parseEarthGeoData } from '../dataset/container.js'
import type { Reader } from './reader.js'
import { dataRoot, defaultReader, fetchReader, isNode, nodeReader } from './reader.js'

export type SourceOptions = {
  /** Where the files are. Defaults to the `data/` folder beside this package. */
  base?: string | URL
  read?: Reader
  signal?: AbortSignal
  /** Check the file against the hash in the manifest. Costs a SHA-256 over the
   *  response — about 300 ms for the 69 MB grid, and worth it once: a truncated
   *  transfer decodes into a perfectly valid container holding half a planet,
   *  which renders as terrain and nothing else. */
  verify?: boolean
}

/** Cached per base, because loading six datasets should not fetch the manifest
 *  six times. A caller-supplied `read` is deliberately not cached: it is often a
 *  stub in a test, and a hidden second request would make that test lie. */
const indexes = new Map<string, Promise<EarthGeoDataIndex>>()
const readers = new Map<string, Reader>()

function keyOf(options: SourceOptions): string {
  return options.base === undefined ? '' : String(options.base)
}

function readerFor(options: SourceOptions): Reader {
  if (options.read) return options.read
  const key = keyOf(options)
  let reader = readers.get(key)
  if (!reader) {
    reader = defaultReader(options.base)
    readers.set(key, reader)
  }
  return reader
}

/** The manifest: every dataset with its shape, size, licence and hash. */
export function datasetIndex(options: SourceOptions = {}): Promise<EarthGeoDataIndex> {
  if (options.read) {
    return options.read('index.json', options.signal).then(parseIndex)
  }
  const key = keyOf(options)
  let pending = indexes.get(key)
  if (!pending) {
    pending = readerFor(options)('index.json', options.signal).then(parseIndex)
    indexes.set(key, pending)
    // a failed read must not be cached, or one offline moment poisons the page
    pending.catch(() => indexes.delete(key))
  }
  return pending
}

function parseIndex(text: string): EarthGeoDataIndex {
  return JSON.parse(text) as EarthGeoDataIndex
}

/** The manifest entry for an id, or the entry whose path matches. */
export async function datasetEntry(
  source: string,
  options: SourceOptions = {},
): Promise<EarthGeoDataIndexEntry> {
  const index = await datasetIndex(options)
  const entry = isPath(source)
    ? index.datasets.find((candidate) => candidate.path === source || candidate.path.endsWith(`/${source}`))
    : index.datasets.find((candidate) => candidate.id === source)

  if (!entry) {
    throw new Error(
      `earthGeoData: no dataset "${source}". The manifest lists ${index.datasets.length}: ` +
      `${index.datasets.map((d) => d.id).join(', ')}`,
    )
  }
  return entry
}

/** True when the string looks like a path rather than an id. Ids never contain
 *  a slash or a dot; every path ends in .json. */
export function isPath(source: string): boolean {
  return source.includes('/') || source.endsWith('.json')
}

/* Open a dataset by id or by path. */
export async function openDataset(
  source: string,
  options: SourceOptions = {},
): Promise<EarthGeoData> {
  const read = readerFor(options)

  if (isPath(source)) {
    const text = await read(source, options.signal)
    if (options.verify) {
      await verify(source, text, (await datasetEntry(source, options)).sha256)
    }
    return parseEarthGeoData(JSON.parse(text) as EarthGeoDataJson)
  }

  const entry = await datasetEntry(source, options)
  const text = await read(entry.path, options.signal)
  if (options.verify) await verify(entry.path, text, entry.sha256)
  return parseEarthGeoData(JSON.parse(text) as EarthGeoDataJson)
}

/** Every dataset in the manifest. */
export async function listDatasets(options: SourceOptions = {}): Promise<EarthGeoDataIndexEntry[]> {
  return (await datasetIndex(options)).datasets
}

async function verify(path: string, text: string, expected: string): Promise<void> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const actual = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (actual !== expected) {
    throw new Error(`earthGeoData: ${path} has sha256 ${actual}, the manifest says ${expected}`)
  }
}

export { dataRoot, defaultReader, fetchReader, isNode, nodeReader }
export type { Reader }
