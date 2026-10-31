import type { Reader } from '../reader/index.js'

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
