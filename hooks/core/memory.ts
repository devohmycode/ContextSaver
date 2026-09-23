// What the plugin remembers about a project, and where: the registry's key, which registries a full store
// gives up, and the lines `/saver patterns` prints. Pure; `register.ts` does the reading and the writing.
import { collapseWs, fit } from './text'
import { DEBUG_MAX_LINES, LIST_KIND, PATTERNS_KEY } from './types'
import type { StoredPattern } from './types'

const DAY_MS = 86_400_000

/** A path as a key: forward slashes, a lowercase drive letter, no trailing slash. */
export const keyPath = (path: string): string => {
  const slashed = path.trim().replaceAll('\\', '/').replace(/\/+$/, '')
  return /^[A-Za-z]:/.test(slashed) ? `${slashed.charAt(0).toLowerCase()}${slashed.slice(1)}` : slashed
}

/**
 * The project a `git rev-parse --path-format=absolute --git-common-dir` answer names: the parent of the
 * main repository's `.git`, which every worktree of it shares. Null for an answer that names nothing.
 */
export const projectKeyOf = (commonDir: string): string | null => {
  const dir = keyPath(commonDir.split('\n')[0] ?? '')
  if (dir === '') return null
  // A bare repository or a submodule's `.git/modules/x` has no parent checkout: the directory is the project.
  return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) || '/' : dir
}

/** The store key of one project's registry. */
export const registryKey = (projectKey: string): string => `${PATTERNS_KEY}${projectKey}`

/** Reads the `projects` index (registry key → its last session's clock), dropping what is not a count. */
export const parseProjects = (value: unknown): Record<string, number> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  )
}

/**
 * The registries to delete so the store's registries fit under `cap`: least recently used first, a key the
 * index never saw counting as used at 0, the current project's never.
 *
 * @param sizes each registry key's JSON length
 * @param projects the `projects` index
 * @param current the registry key of the session's own project
 * @param cap the summed length to get under
 */
export const evictions = (sizes: Readonly<Record<string, number>>, projects: Readonly<Record<string, number>>, current: string, cap: number): string[] => {
  let total = Object.values(sizes).reduce((n, size) => n + size, 0)
  const order = Object.keys(sizes)
    .filter(key => key !== current)
    .sort((a, b) => (projects[a] ?? 0) - (projects[b] ?? 0) || a.localeCompare(b))
  const out: string[] = []
  for (const key of order) {
    if (total <= cap) break
    out.push(key)
    total -= sizes[key] ?? 0
  }
  return out
}

/** A clock reading as `YYYY-MM-DD` (UTC), or `-` for 0; the civil calendar computed, since `Date` is not the plugin's. */
export const isoDay = (ms: number): string => {
  if (!(ms > 0)) return '-'
  // Howard Hinnant's days-to-civil: eras of 400 years, March-based years so the leap day falls last.
  const z = Math.floor(ms / DAY_MS) + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${year}-${two(month)}-${two(day)}`
}

/** The registry in the order `/saver patterns` numbers it: the most recently seen first, then by id. */
export const listed = (stored: readonly StoredPattern[]): StoredPattern[] =>
  [...stored].sort((a, b) => b.seen.last - a.seen.last || a.id.localeCompare(b.id))

/** The pattern `/saver forget` names by its number in `listed` order or by its id; undefined when none. */
export const namedIn = (stored: readonly StoredPattern[], token: string): StoredPattern | undefined => {
  const order = listed(stored)
  return /^\d+$/.test(token) ? order[Number(token) - 1] : order.find(p => p.id === token)
}

/** What `/saver patterns` prints: one line per learned pattern, numbered as `/saver forget` takes them. */
export const registryLines = (stored: readonly StoredPattern[], projectKey: string): string => {
  if (stored.length === 0) return `ContextSaver: nothing learned for ${projectKey} yet`
  const head = `ContextSaver: ${stored.length} pattern${stored.length === 1 ? '' : 's'} learned for ${projectKey}`
  const lines = listed(stored).map((p, i) =>
    `${i + 1} · ${p.id} · ${fit(collapseWs(p.kind), LIST_KIND)} · ${p.lastDecision ?? 'undecided'} · ×${p.seen.sessions} · ${isoDay(p.seen.last)}`)
  const room = DEBUG_MAX_LINES - 1
  const shown = lines.length > room ? [...lines.slice(0, room - 1), `… ${lines.length - room + 1} more`] : lines
  return [head, ...shown].join('\n')
}
