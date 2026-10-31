#!/usr/bin/env node
/* Turns the reviewer's JSON answer into the body of a GitHub review: every
   finding that quotes a line the pull request adds becomes a comment on that
   line, and every finding that cannot be placed becomes a bullet in the review
   text. Nothing here talks to GitHub — it writes request bodies and the workflow
   posts one of them.

   The quote, not a line number, is what places a comment. A line number would
   have to be counted off the diff hunk headers by the model, and a comment on
   the wrong line is worse than a comment that is only in the text. */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const base = process.env.BASE_BRANCH ?? 'main'
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek'
const effort = process.env.REASONING_EFFORT ?? 'max'
const event = process.env.REVIEW_EVENT || 'COMMENT'
const most = 12

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const commit = process.env.HEAD_SHA?.trim() ||
  git('rev-parse', 'HEAD').trim()

const warn = (message) => console.error(`note: ${message}`)

/* The workflow already works out which files changed, with the same exclusions
   it uses for the diff it shows the model. Read that file so the two cannot
   disagree about what counts as part of the pull request. */
const changedFiles = () => {
  if (!existsSync('changed-files.txt')) {
    throw new Error('changed-files.txt is missing; the workflow writes it before calling this script')
  }
  return readFileSync('changed-files.txt', 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
}

/* New-side line numbers of every line the pull request adds, keyed by path and
   then by the line's text. The whole diff is read at once, not one file at a
   time, because git only pairs a rename with the file it came from when it sees
   both sides: GitHub shows the same rename, so a line that merely moved is not a
   line a comment can be attached to. Context lines inside a hunk are skipped
   too — the pull request did not write them. */
const indexAddedLines = (diff) => {
  const index = new Map()
  const linesOf = (path) => {
    if (!index.has(path)) index.set(path, new Map())
    return index.get(path)
  }

  let path = ''
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      path = ''
      line = 0
      continue
    }
    // Only in the header: inside a hunk this shape is an added line.
    if (line === 0 && raw.startsWith('+++ ')) {
      const target = raw.slice(4).trim()
      path = target === '/dev/null' ? '' : target.replace(/^b\//, '')
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (line === 0 || path === '') continue
    if (raw.startsWith('+')) {
      const text = raw.slice(1).trim()
      if (text) {
        const seen = linesOf(path)
        seen.set(text, [...(seen.get(text) ?? []), line])
      }
      line += 1
    } else if (raw.startsWith(' ')) {
      line += 1
    }
  }
  return index
}

/* Read once, on first use, with the same exclusions the workflow uses for the
   diff it shows the model. -U0 is enough: only added lines can take a comment. */
let addedIndex = null
const addedLines = (path) => {
  if (addedIndex === null) {
    addedIndex = indexAddedLines(git(
      'diff', '--unified=0', `origin/${base}...HEAD`,
      '--', '.', ':(exclude)data/**', ':(exclude)dist/**', ':(exclude)package-lock.json',
    ))
  }
  return addedIndex.get(path) ?? new Map()
}

const fileCache = new Map()
const fileAtHead = (path) => {
  if (!fileCache.has(path)) {
    let text = null
    try {
      text = git('show', `HEAD:${path}`)
    } catch {
      text = null
    }
    fileCache.set(path, text)
  }
  return fileCache.get(path)
}

const safePath = (path) =>
  /^[A-Za-z0-9._/-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..')

/* Where a finding goes: the line its quote was copied from, or the reason it
   cannot have one. */
const place = (finding, changed) => {
  const path = typeof finding.path === 'string' ? finding.path.trim() : ''
  if (!safePath(path)) return { reason: 'no usable path' }
  if (!changed.has(path)) return { reason: 'the path is not one the pull request changes' }

  const quote = typeof finding.quote === 'string' ? finding.quote.trim() : ''
  if (!quote) return { reason: 'no line quoted' }

  const index = addedLines(path)
  // Models copy the line, but sometimes copy the diff's leading plus with it.
  for (const candidate of [quote, quote.replace(/^\+\s?/, '')]) {
    const lines = index.get(candidate)
    if (!lines) continue

    const file = fileAtHead(path)
    if (file === null) return { reason: 'the file cannot be read at this commit' }
    const actual = (file.split('\n')[lines[0] - 1] ?? '').trim()
    if (actual !== candidate) return { reason: 'the diff and the file disagree about that line' }

    return { path, line: lines[0], text: candidate, duplicate: lines.length > 1 }
  }
  return { reason: 'the quoted line is not one the pull request adds' }
}

const parseAnswer = (text) => {
  let body = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(body)
  if (fenced) body = fenced[1].trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in the answer')
  return JSON.parse(body.slice(start, end + 1))
}

const bullet = (finding) => {
  const path = typeof finding.path === 'string' ? finding.path : '(no path)'
  const body = typeof finding.body === 'string' ? finding.body.replace(/\s+/g, ' ').trim() : ''
  return `- \`${path}\`: ${body || '(no explanation)'}`
}

const writeRequests = (body, flat, verdict, comments) => {
  writeFileSync('review-request.json', `${JSON.stringify({ commit_id: commit, event, body, comments }, null, 2)}\n`)
  writeFileSync('review-request-flat.json', `${JSON.stringify({ commit_id: commit, event, body: flat, comments: [] }, null, 2)}\n`)
  writeFileSync('verdict.txt', `${verdict}\n`)
}

const answer = readFileSync('review.json', 'utf8')

let review
try {
  review = parseAnswer(answer)
} catch {
  warn('the answer was not JSON, so it is posted as one comment with nothing placed on a line')
  const text = answer.trim().slice(0, 60000) || '(the review came back empty)'
  const body = [
    `**DeepSeek review** (${model}, reasoning ${effort}) — the answer was not JSON`,
    text,
    'VERDICT: UNKNOWN',
  ].join('\n\n')
  writeRequests(body, body, 'UNKNOWN', [])
  process.exit(0)
}

const changed = new Set(changedFiles())
const findings = (Array.isArray(review.findings) ? review.findings : [])
  .filter((finding) => finding && typeof finding === 'object')
const kept = findings.slice(0, most)
const dropped = findings.length - kept.length

const placed = []
const unplaced = []
for (const finding of kept) {
  const spot = place(finding, changed)
  if (spot.reason) {
    unplaced.push(finding)
    warn(`${finding.path ?? '(no path)'} — ${spot.reason}`)
    continue
  }
  if (spot.duplicate) warn(`${spot.path}:${spot.line} — that line is added more than once; used the first`)
  placed.push({ ...finding, path: spot.path, line: spot.line })
}

const verdict = (() => {
  const said = String(review.verdict ?? '').toUpperCase().trim()
  if (said === 'BLOCK' || said === 'PASS') return said
  return kept.length > 0 ? 'BLOCK' : 'PASS'
})()

const summary = typeof review.summary === 'string' ? review.summary.replace(/\s+/g, ' ').trim() : ''

const header = `**DeepSeek review** (${model}, reasoning ${effort}) — ${placed.length} of ${kept.length} findings on a line`

const body = [
  header,
  summary,
  unplaced.length ? ['### Not placed on a line', unplaced.map(bullet).join('\n')].join('\n\n') : '',
  dropped > 0 ? `${dropped} further findings were left out of the answer's ${most}.` : '',
  `VERDICT: ${verdict}`,
].filter(Boolean).join('\n\n')

const flat = [
  header,
  summary,
  kept.length ? ['### Every finding, unplaced', kept.map(bullet).join('\n')].join('\n\n') : 'No findings.',
  dropped > 0 ? `${dropped} further findings were left out of the answer's ${most}.` : '',
  `VERDICT: ${verdict}`,
].filter(Boolean).join('\n\n')

const comments = placed.map((finding) => ({
  path: finding.path,
  line: finding.line,
  side: 'RIGHT',
  body: typeof finding.body === 'string' ? finding.body.trim() : '',
}))

writeRequests(body, flat, verdict, comments)

console.log(`${placed.length} on a line, ${unplaced.length} in the text, verdict ${verdict}`)
for (const finding of placed) console.log(`  ${finding.path}:${finding.line}  ${finding.body.slice(0, 60)}`)
