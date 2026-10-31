#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
   prepare-data.mjs — fill data/ with the grids, and describe what is in it

   Two kinds of dataset end up in the package:

     · the elevation grids, copied byte for byte out of a source folder that
       holds an earthGeoData manifest (the learning project's public data)
     · everything else — the land-cover grid — fetched straight into data/ by
       its own script, `scripts/fetch-landcover.py`

   Neither order is wrong, and neither script has to know about the other. This
   one copies what the source offers, then walks data/ and writes a manifest
   entry for every dataset file it finds — hashing each one from disk, and
   reading the envelope of any file the source did not describe. The manifest
   therefore describes the folder as it actually is, which is exactly what
   `test/run.mjs` checks it against.

     npm run prepare-data                                  (the sibling folder)
     EARTHGEO_SOURCE=/path/to/earthGeoData npm run prepare-data
     node scripts/prepare-data.mjs /path/to/earthGeoData
   ════════════════════════════════════════════════════════════════════════════ */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')
const out = join(pkg, 'data')

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

const index = JSON.parse(await readFile(join(source, 'index.json'), 'utf8'))

/** The seven grids: the five Terrarium resolutions, and ETOPO's two surfaces. */
const isElevation = (entry) =>
  entry.path.startsWith('terrain/terrain-') || entry.path.startsWith('etopo/')

const elevation = index.datasets.filter(isElevation)

if (!elevation.length) {
  console.error(`no elevation datasets in ${source}/index.json`)
  process.exit(1)
}

await mkdir(out, { recursive: true })

for (const entry of elevation) {
  const to = join(out, entry.path)
  await mkdir(dirname(to), { recursive: true })
  await copyFile(join(source, entry.path), to)
}

/** Every dataset file in data/, relative to it and sorted. index.json is not one. */
async function datasetsIn(dir, prefix = '') {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...await datasetsIn(join(dir, entry.name), path))
    else if (entry.name.endsWith('.json') && path !== 'index.json') found.push(path)
  }
  return found.sort()
}

/* An entry for a file the source manifest did not describe. Everything in it is
   read out of the envelope the file carries — the same fields the source uses,
   so both kinds of entry sit in one list without a special case. */
function describe(path, envelope, bytes, sha256) {
  const grid = envelope.grid ?? {}
  const from = envelope.source ?? {}

  return {
    id: envelope.id,
    path,
    kind: envelope.kind,
    title: envelope.title,
    width: grid.width,
    height: grid.height,
    unit: grid.unit,
    bytes,
    sourceBytes: envelope.byteLength,
    sha256,
    licence: from.licence,
    attribution: from.attribution,
    retrieved: from.retrieved,
    stats: envelope.stats,
  }
}

const fromSource = new Map(elevation.map((entry) => [entry.path, entry]))
const onDisk = await datasetsIn(out)
const datasets = []

for (const path of onDisk) {
  const body = await readFile(join(out, path))
  const sha256 = createHash('sha256').update(body).digest('hex')
  const entry = fromSource.get(path)

  datasets.push(
    entry
      ? { ...entry, bytes: body.length, sha256 }
      : describe(path, JSON.parse(body.toString('utf8')), body.length, sha256),
  )
}

/* Elevation first, in the order the source listed it; anything else after. */
const rank = new Map(elevation.map((entry, at) => [entry.path, at]))
datasets.sort((a, b) => {
  const left = rank.get(a.path) ?? Number.MAX_SAFE_INTEGER
  const right = rank.get(b.path) ?? Number.MAX_SAFE_INTEGER
  return left - right || onDisk.indexOf(a.path) - onDisk.indexOf(b.path)
})

let bytes = 0
let payload = 0
const licences = {}
const byKind = {}

for (const entry of datasets) {
  bytes += entry.bytes
  payload += entry.sourceBytes ?? 0
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
    records: 0,
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
