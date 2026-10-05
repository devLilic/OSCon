import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { labDataDirectory } from '../../../electron/main/modules/lab/dataPaths'

describe('LAB output path', () => {
  it('uses writable userData for the default output folder in development and packaged builds', () => {
    expect(labDataDirectory({ userData: path.resolve('user-data') })).toBe(path.join(path.resolve('user-data'), 'output'))
  })
  it('allows an isolated output directory override', () => {
    expect(labDataDirectory({ userData: 'user-data', override: 'isolated' })).toBe('isolated')
  })
})
