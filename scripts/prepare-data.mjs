#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   prepare-data.mjs — copy the elevation datasets in, and write the manifest

   The package ships seven grids and nothing else. They are copied, byte for
   byte, out of the learning project's public data folder, and the manifest is
   rebuilt around them — same entries, same hashes, filtered down.

   Copying rather than moving, so the learning project keeps working and the two
   can be compared. The copies are checked against the manifest hashes by
   `test/run.mjs`, which is what makes "byte for byte" a claim rather than a hope.

     node scripts/prepare-data.mjs
     EARTHGEO_SOURCE=/path/to/earthGeoData node scripts/prepare-data.mjs
   ════════════════════════════════════════════════════════════════════════════ */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')

/* Where the source grids live is a property of the machine, not of the repo:
   the data is not committed. Take it from the argument, then the environment,
   then the one place it has always been — and if none of those exist, say so
   instead of failing on a read three lines later. */
const source = [
  process.argv[2],
  process.env.EARTHGEO_SOURCE,
  join(pkg, '..', 'learningThreeWithDeepSeek', 'public', 'data', 'earthGeoData'),
].find((path) => path && existsSync(join(path, 'index.json')))

if (!source) {
  console.error(
    'No earthGeoData folder found. Point me at the folder holding index.json:\n\n' +
    '  EARTHGEO_SOURCE=/path/to/earthGeoData npm run prepare-data\n' +
    '  node scripts/prepare-data.mjs /path/to/earthGeoData\n',
  )
  process.exit(1)
}

const out = join(pkg, 'data')

/** The seven grids: the five Terrarium resolutions, and ETOPO's two surfaces. */
const isElevation = (entry) =>
  entry.path.startsWith('terrain/terrain-') || entry.path.startsWith('etopo/')

const index = JSON.parse(await readFile(join(source, 'index.json'), 'utf8'))
const elevation = index.datasets.filter(isElevation)

if (!elevation.length) {
  console.error(`no elevation datasets in ${source}/index.json`)
  process.exit(1)
}

/* Everything that is not elevation — the land-cover grid, and anything else
   fetched from elsewhere — is not in the learning project's manifest, so this
   script must not be the thing that deletes it. Entries already in this
   package's own manifest are kept as they are, provided the file is still on
   disk; the rest of the manifest is rebuilt around them. */
let existing = { datasets: [] }
try {
  existing = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'))
} catch {
  // first run: there is nothing to preserve
}
const kept = existing.datasets.filter(
  (entry) => !isElevation(entry) && existsSync(join(out, entry.path)),
)

const datasets = [...elevation, ...kept]

await mkdir(out, { recursive: true })

let bytes = 0
let payload = 0
let records = 0
const licences = {}
const byKind = {}

for (const entry of datasets) {
  /* Only the elevation grids are copied. Everything else was fetched straight
     into this package by its own script and is already where it belongs. */
  if (isElevation(entry)) {
    const from = join(source, entry.path)
    const to = join(out, entry.path)
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
  }

  bytes += entry.bytes
  payload += entry.sourceBytes
  records += entry.records ?? 0
  byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1
  ;(licences[entry.licence] ??= []).push(entry.id)

  console.log(
    `  ${entry.id.padEnd(24)} ${(entry.bytes / 1e6).toFixed(2).padStart(8)} MB  ` +
    `${entry.width}x${entry.height}`,
  )
}

const manifest = {
  format: index.format,
  generated: new Date().toISOString().slice(0, 10),
  root: './',
  totals: {
    datasets: datasets.length,
    bytes,
    megabytes: Number((bytes / 1e6).toFixed(1)),
    records,
  },
  licences,
  byKind,
  datasets,
}

await writeFile(join(out, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(
  `\n${datasets.length} datasets, ${(bytes / 1e6).toFixed(1)} MB of JSON, ` +
  `${(payload / 1e6).toFixed(1)} MB of payload -> ${out}`,
)
