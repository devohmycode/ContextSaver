import { describe, expect, test } from 'claude-code/testing'

import { evictions, isoDay, keyPath, listed, namedIn, parseProjects, projectKeyOf, registryKey, registryLines } from '../hooks/core/memory'
import { toStored } from '../hooks/core/patterns'
import { DEBUG_MAX_LINES } from '../hooks/core/types'
import type { StoredPattern } from '../hooks/core/types'
import { chattyPattern } from './fixtures/patterns/chattyPattern'
import { suitePattern } from './fixtures/patterns/suitePattern'

// Two learned patterns, the chatty one seen last.
const SUITE: StoredPattern = { ...toStored(suitePattern), lastDecision: 'kill', seen: { sessions: 3, last: 1_700_000_000_000 } }
const CHATTY: StoredPattern = { ...toStored(chattyPattern), seen: { sessions: 1, last: 1_700_100_000_000 } }

describe('memory', () => {
  test('keyPath writes a path one way whatever the host spelled it', ($, _on) => {
    expect(keyPath('C:\\Users\\me\\repo\\')).toBe('c:/Users/me/repo')
    expect(keyPath('  /home/me/repo/ \n')).toBe('/home/me/repo')
    expect(keyPath('/')).toBe('')
  })

  test('projectKeyOf gives every worktree of a repository the key of its main checkout', ($, _on) => {
    // `--git-common-dir` answers the main repository's `.git` from the checkout and from any worktree alike.
    expect(projectKeyOf('/home/me/repo/.git\n')).toBe('/home/me/repo')
    expect(projectKeyOf('C:/Users/me/repo/.git\n')).toBe('c:/Users/me/repo')
    expect(projectKeyOf('/srv/mirror.git\n'), 'a bare repository is its own project').toBe('/srv/mirror.git')
    expect(projectKeyOf('/home/me/app/.git/modules/lib\n'), 'a submodule keeps its own registry').toBe('/home/me/app/.git/modules/lib')
    expect(projectKeyOf('\n')).toBeNull()
    expect(registryKey('/home/me/repo')).toBe('patterns:/home/me/repo')
  })

  test('parseProjects keeps the dated keys and drops everything else', ($, _on) => {
    expect(parseProjects({ 'patterns:/a': 5, 'patterns:/b': 'x', 'patterns:/c': Number.NaN })).toEqual({ 'patterns:/a': 5 })
    expect(parseProjects(undefined)).toEqual({})
    expect(parseProjects([1, 2])).toEqual({})
  })

  test('evictions gives up the least recently used registries until the rest fit, never the current one', ($, _on) => {
    const sizes = { 'patterns:/old': 400, 'patterns:/undated': 300, 'patterns:/recent': 500, 'patterns:/here': 900 }
    const projects = { 'patterns:/old': 10, 'patterns:/recent': 90, 'patterns:/here': 1 }
    expect(evictions(sizes, projects, 'patterns:/here', 2_100), 'everything fits: nothing goes').toEqual([])
    expect(evictions(sizes, projects, 'patterns:/here', 1_800), 'a registry the index never dated goes first').toEqual(['patterns:/undated'])
    expect(evictions(sizes, projects, 'patterns:/here', 1_000)).toEqual(['patterns:/undated', 'patterns:/old', 'patterns:/recent'])
    expect(evictions(sizes, projects, 'patterns:/here', 100), 'the session\'s own project stays, even over the cap')
      .toEqual(['patterns:/undated', 'patterns:/old', 'patterns:/recent'])
  })

  test('isoDay dates a clock reading on the civil calendar', ($, _on) => {
    expect(isoDay(0)).toBe('-')
    expect(isoDay(1)).toBe('1970-01-01')
    expect(isoDay(1_700_000_000_000)).toBe('2023-11-14')
    expect(isoDay(951_782_400_000), 'the leap day of a century divisible by 400').toBe('2000-02-29')
    expect(isoDay(1_709_164_800_000)).toBe('2024-02-29')
    expect(isoDay(1_735_689_599_000)).toBe('2024-12-31')
  })

  test('listed and namedIn number the registry as /saver patterns prints it', ($, _on) => {
    expect(listed([SUITE, CHATTY]).map(p => p.id), 'the most recently seen first').toEqual([CHATTY.id, SUITE.id])
    expect(namedIn([SUITE, CHATTY], '1')?.id).toBe(CHATTY.id)
    expect(namedIn([SUITE, CHATTY], SUITE.id)?.id).toBe(SUITE.id)
    expect(namedIn([SUITE, CHATTY], '3')).toBeUndefined()
    expect(namedIn([SUITE, CHATTY], 'execution:nothing')).toBeUndefined()
  })

  test('registryLines prints one numbered line per pattern and stays under the reply ceiling', ($, _on) => {
    expect(registryLines([], '/home/me/repo')).toBe('ContextSaver: nothing learned for /home/me/repo yet')
    const text = registryLines([SUITE, CHATTY], '/home/me/repo')
    expect(text.split('\n')[0]).toBe('ContextSaver: 2 patterns learned for /home/me/repo')
    expect(text).toContain(`1 · ${CHATTY.id} · `)
    expect(text).toContain(`2 · ${SUITE.id} · Claude keeps running the whole bun test suite after every s… · kill · ×3 · 2023-11-14`)
    expect(text, 'a pattern nobody decided says so').toContain('· undecided · ×1 · 2023-11-16')
    const many = Array.from({ length: 50 }, (_, i) => ({ ...CHATTY, id: `behavior:p-${String(i).padStart(2, '0')}` }))
    const long = registryLines(many, '/r').split('\n')
    expect(long).toHaveLength(DEBUG_MAX_LINES)
    expect(long.at(-1)).toBe(`… ${50 - (DEBUG_MAX_LINES - 2)} more`)
  })
})
