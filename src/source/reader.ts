
/** Read one file's text. Overridable, which is how the tests run without a disk. */
export type Reader = (path: string, signal?: AbortSignal) => Promise<string>

/* The folder the data ships in, resolved from this file's compiled location. */
export const dataRoot = new URL('../../data/', import.meta.url)

export function isNode(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.node === 'string'
}

function isHttp(base: string | URL | undefined): boolean {
  if (base === undefined) return false
  const text = typeof base === 'string' ? base : base.href
  return text.startsWith('http://') || text.startsWith('https://')
}

/* A URL from a string that might be absolute, or relative to the page. */
function absolute(raw: string): URL {
  try {
    return new URL(raw)
  } catch {
    // not absolute: let the page resolve it
  }
  const location = (globalThis as { location?: { href: string } }).location
  if (location) return new URL(raw, location.href)
  throw new Error(
    `earthGeoData: "${raw}" is not an absolute URL and there is no page to resolve ` +
    'it against. In Node pass a folder path; in a browser pass "/data/" or a full URL.',
  )
}

/** Guaranteed to end in a slash so `new URL(path, it)` appends to the directory
 *  instead of replacing its last segment. */
function asDirectory(url: URL): URL {
  return url.pathname.endsWith('/') ? url : new URL(`${url.href}/`)
}

/** Read from disk. `base` is a folder path or a file: URL. */
export function nodeReader(base: string | URL = dataRoot): Reader {
  return async (path) => {
    const { readFile } = await import('node:fs/promises')
    let root: URL
    if (base instanceof URL) {
      root = asDirectory(base)
    } else {
      const { pathToFileURL } = await import('node:url')
      root = asDirectory(base.startsWith('file:') ? new URL(base) : pathToFileURL(base))
    }
    return readFile(new URL(path, root), 'utf8')
  }
}

/** Read over the network. `base` has to be an absolute URL — `/data/` is not
 *  enough on its own, because relative to what is the browser's question, not
 *  this package's. */
export function fetchReader(base: string | URL): Reader {
  const root = asDirectory(typeof base === 'string' ? absolute(base) : asDirectory(base))
  return async (path, signal) => {
    const url = new URL(path, root)
    const response = await fetch(url, signal ? { signal } : undefined)
    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
}

/* The reader to use when the caller did not name one. */
export function defaultReader(base?: string | URL): Reader {
  if (isHttp(base)) return fetchReader(base as string | URL)
  if (isNode()) return nodeReader(base ?? dataRoot)
  if (base === undefined) {
    throw new Error(
      'earthGeoData: no base to read from. In a browser the data has to be served ' +
      'from somewhere — pass { base: "/data/" } or a full URL to openDataset().',
    )
  }
  return fetchReader(base)
}
