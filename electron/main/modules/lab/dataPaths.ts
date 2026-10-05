import path from 'node:path'

export function labDataDirectory({ userData, override }: {
  userData: string; override?: string
}): string {
  return override || path.join(userData, 'output')
}
