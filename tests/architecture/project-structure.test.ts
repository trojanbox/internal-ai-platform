import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? walk(path) : [path]
    }),
  )
  return files.flat()
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function workspacePath(path: string): string {
  return relative(root, path).split(sep).join('/')
}

describe('project structure contract', () => {
  it('keeps private CSS Modules with their owner instead of importing from parents', async () => {
    const sourceRoot = resolve(root, 'apps/web/src')
    const sourceFiles = (await walk(sourceRoot)).filter((path) => /\.(ts|tsx)$/.test(path))
    const violations: string[] = []

    for (const path of sourceFiles) {
      const source = await readFile(path, 'utf8')
      for (const match of source.matchAll(/from\s+['"]([^'"]+\.module\.css)['"]/g)) {
        const importPath = match[1]
        if (importPath?.startsWith('../')) {
          violations.push(`${workspacePath(path)} -> ${importPath}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('uses explicit layout and infrastructure boundaries', async () => {
    expect(await exists(resolve(root, 'apps/web/src/layout'))).toBe(true)
    expect(await exists(resolve(root, 'apps/web/src/infrastructure/http/api.client.ts'))).toBe(true)
    expect(await exists(resolve(root, 'apps/web/src/shell'))).toBe(false)
    expect(await exists(resolve(root, 'apps/web/src/lib'))).toBe(false)
  })

  it('keeps workspace package roots as public API surfaces', async () => {
    for (const packageName of ['contracts', 'i18n', 'ui']) {
      const sourceRoot = resolve(root, `packages/${packageName}/src`)
      const rootFiles = (await readdir(sourceRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
        .map((entry) => entry.name)
        .sort()

      expect(rootFiles).toEqual(['index.ts'])
    }
  })

  it('categorizes reusable UI components below a component family', async () => {
    const componentsRoot = resolve(root, 'packages/ui/src/components')
    const componentFiles = (await walk(componentsRoot)).filter((path) => path.endsWith('.tsx'))
    const violations = componentFiles
      .map((path) => relative(componentsRoot, path).split(sep))
      .filter((parts) => parts.length < 3)
      .map((parts) => parts.join('/'))

    expect(violations).toEqual([])
  })

  it('uses static classes for stateless feature services and the HTTP client', async () => {
    const featureRoot = resolve(root, 'apps/web/src/features')
    const serviceFiles = (await walk(featureRoot)).filter((path) => path.endsWith('.service.ts'))
    const violations: string[] = []

    for (const path of serviceFiles) {
      const source = await readFile(path, 'utf8')
      if (!/export class \w+Service/.test(source) || !/static async /.test(source)) {
        violations.push(workspacePath(path))
      }
    }

    const apiClient = await readFile(
      resolve(root, 'apps/web/src/infrastructure/http/api.client.ts'),
      'utf8',
    )
    expect(violations).toEqual([])
    expect(apiClient).toContain('export class ApiClient')
    expect(apiClient).toContain('protected static basePath')
  })

  it('uses the unified radix-ui package only behind @repo/ui', async () => {
    const uiPackage = JSON.parse(
      await readFile(resolve(root, 'packages/ui/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const webPackage = JSON.parse(
      await readFile(resolve(root, 'apps/web/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const uiSourceFiles = (await walk(resolve(root, 'packages/ui/src'))).filter((path) =>
      /\.(ts|tsx)$/.test(path),
    )
    const webSourceFiles = (await walk(resolve(root, 'apps/web/src'))).filter((path) =>
      /\.(ts|tsx)$/.test(path),
    )
    const uiSources = await Promise.all(uiSourceFiles.map((path) => readFile(path, 'utf8')))
    const webSources = await Promise.all(webSourceFiles.map((path) => readFile(path, 'utf8')))

    expect(uiPackage.dependencies?.['radix-ui']).toBeDefined()
    expect(
      Object.keys(uiPackage.dependencies ?? {}).filter((name) =>
        name.startsWith('@radix-ui/react-'),
      ),
    ).toEqual([])
    expect(webPackage.dependencies?.['radix-ui']).toBeUndefined()
    expect(uiSources.some((source) => source.includes("from 'radix-ui'"))).toBe(true)
    expect(uiSources.some((source) => source.includes("from '@radix-ui/"))).toBe(false)
    expect(webSources.some((source) => source.includes("from 'radix-ui'"))).toBe(false)
  })

  it('co-locates backend unit tests with their production owner', async () => {
    const apiSourceRoot = resolve(root, 'apps/api/src')
    const unitTests = (await walk(apiSourceRoot)).filter((path) => path.endsWith('.test.ts'))
    const orphanTests: string[] = []

    for (const testPath of unitTests) {
      const subjectPath = testPath.replace(/\.test\.ts$/, '.ts')
      if (!(await exists(subjectPath))) orphanTests.push(workspacePath(testPath))
    }

    expect(await exists(resolve(root, 'tests/unit'))).toBe(false)
    expect(unitTests.length).toBeGreaterThan(0)
    expect(orphanTests).toEqual([])
  })

  it('ships one initial PostgreSQL migration and schema snapshot without history replay', async () => {
    const migrationsDir = resolve(root, 'apps/api/drizzle')
    const metadataDir = resolve(migrationsDir, 'meta')
    const sqlFiles = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql'))
    const snapshots = (await readdir(metadataDir)).filter((file) => file.endsWith('_snapshot.json'))
    const sql = await readFile(resolve(migrationsDir, '0000_initial_schema.sql'), 'utf8')
    const journal = JSON.parse(await readFile(resolve(metadataDir, '_journal.json'), 'utf8')) as {
      entries: { tag: string }[]
    }
    const snapshot = JSON.parse(
      await readFile(resolve(metadataDir, '0000_snapshot.json'), 'utf8'),
    ) as { tables: Record<string, unknown> }

    expect(sqlFiles).toEqual(['0000_initial_schema.sql'])
    expect(snapshots).toEqual(['0000_snapshot.json'])
    expect(journal.entries.map((entry) => entry.tag)).toEqual(['0000_initial_schema'])
    expect(Object.keys(snapshot.tables).sort()).toEqual(['public.items', 'public.users'])
    expect(sql).toContain('CREATE TABLE "users"')
    expect(sql).toContain('CREATE TABLE "items"')
    expect(sql).toContain('"created_by" uuid')
    expect(sql).toContain('"updated_by" uuid')
    expect(sql).toContain('users_touch_updated_at')
    expect(sql).toContain('items_touch_updated_at')
    expect(sql).not.toContain('DROP TABLE')
    expect(sql).not.toContain('auth_sessions')
    expect(sql).not.toContain('auth_rate_limits')
  })

  it('keeps curated long-term documentation separate from task-level agent notes', async () => {
    const agentGuide = await readFile(resolve(root, 'AGENTS.md'), 'utf8')
    const readme = await readFile(resolve(root, 'README.md'), 'utf8')
    const policy = await readFile(resolve(root, 'docs/documentation-policy.md'), 'utf8')
    const gitignore = await readFile(resolve(root, '.gitignore'), 'utf8')
    const prettierIgnore = await readFile(resolve(root, '.prettierignore'), 'utf8')
    const longTermDocs = [
      'docs/architecture.md',
      'docs/authentication-and-security.md',
      'docs/testing-strategy.md',
      'docs/documentation-policy.md',
    ]

    for (const path of longTermDocs) expect(await exists(resolve(root, path))).toBe(true)
    expect(gitignore).toContain('.agents/work/')
    expect(prettierIgnore).toContain('.agents/work/')
    expect(policy).toContain('六个月以后')
    expect(policy).toContain('## 3. 默认不得进入 `docs/` 的内容')
    expect(policy).toContain('## 5. 单一事实来源')
    expect(agentGuide).toContain('docs/documentation-policy.md')
    expect(agentGuide).toContain('docs/architecture.md')
    expect(readme).toContain('docs/authentication-and-security.md')
    expect(readme).toContain('docs/testing-strategy.md')
  })
})
