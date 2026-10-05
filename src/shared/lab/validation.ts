import type { BufferId, GraphicFields, HeadlineBufferConfig, HeadlineSettings, LabSettings, PersonTextSettings, TemplateType } from './contracts'

export function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Payload LAB invalid.')
  return value as Record<string, unknown>
}
export function mergeGraphicFields(value: unknown, base: GraphicFields): GraphicFields {
  if (value === undefined) return { ...base }
  const patch = objectPayload(value)
  for (const key of Object.keys(patch)) {
    if (key !== 'primary' && key !== 'secondary') throw new Error('Câmp textual necunoscut.')
    if (typeof patch[key] !== 'string' || patch[key].length > 2000 || /[\x00-\x1f]/.test(patch[key])) {
      throw new Error('Text invalid: maximum 2000 de caractere, fără caractere de control.')
    }
  }
  return { primary: patch.primary === undefined ? base.primary : patch.primary as string,
    secondary: patch.secondary === undefined ? base.secondary : patch.secondary as string }
}
export function templateType(value: unknown): TemplateType {
  if (value !== 'headline' && value !== 'name') throw new Error('Template necunoscut.')
  return value
}
export function contentName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\x00-\x1f]/.test(value)) {
    throw new Error('Numele contentului trebuie să aibă 1–100 caractere, fără caractere de control.')
  }
  return value.trim()
}
export function validateSettings(value: unknown): LabSettings {
  const payload = objectPayload(value)
  if (![100, 250, 500, 1000].includes(payload.jsonDelayMs as number)) throw new Error('Delay JSON invalid.')
  const transitionGapMs = payload.headlineTransitionGapMs === undefined ? 100 : payload.headlineTransitionGapMs
  if (![0, 50, 100, 150, 200, 250, 500, 1000].includes(transitionGapMs as number)) throw new Error('Gap-ul de tranziție Headline invalid.')
  const personDurationMs = payload.personDurationMs === undefined ? 5000 : payload.personDurationMs
  if (!Number.isInteger(personDurationMs) || (personDurationMs as number) < 1000 || (personDurationMs as number) > 60000) throw new Error('Durata Person trebuie să fie între 1000 și 60000 ms.')
  const rawPersonText = payload.personText
  const personText: PersonTextSettings | undefined = rawPersonText === undefined ? undefined : (() => {
    const item = objectPayload(rawPersonText)
    const value = { namePath: textFilePath(item.namePath), rolePath: textFilePath(item.rolePath) }
    if (normalizePathKey(value.namePath) === normalizePathKey(value.rolePath)) throw new Error('Fișierele TXT pentru Person trebuie să fie distincte.')
    return value
  })()
  const names = objectPayload(payload.contentNames)
  const headline = contentName(names.headline)
  const name = contentName(names.name)
  const rawHeadline = payload.headline
  if (rawHeadline === undefined) {
    if (headline === name) throw new Error('Contenturile Headline și Name trebuie să aibă nume distincte.')
    return { jsonDelayMs: payload.jsonDelayMs as LabSettings['jsonDelayMs'], headlineTransitionGapMs: transitionGapMs as LabSettings['headlineTransitionGapMs'], personDurationMs: personDurationMs as number, ...(personText ? { personText } : {}), contentNames: { headline, name } }
  }
  const headlineSettings = objectPayload(rawHeadline)
  if (headlineSettings.mode !== 'external-txt' && headlineSettings.mode !== 'internal-json') throw new Error('Modul Headline invalid.')
  let normalizedHeadline: HeadlineSettings | undefined
  if (headlineSettings.mode === 'external-txt') {
    const rawBuffers = objectPayload(headlineSettings.buffers)
    const readBuffer = (id: BufferId): HeadlineBufferConfig => {
      const item = objectPayload(rawBuffers[id])
      return {
        contentName: contentName(item.contentName),
        kickerPath: textFilePath(item.kickerPath),
        titlePath: textFilePath(item.titlePath),
      }
    }
    const buffers = { A: readBuffer('A'), B: readBuffer('B') }
    const textPaths = [buffers.A.kickerPath, buffers.A.titlePath, buffers.B.kickerPath, buffers.B.titlePath]
    const allPaths = personText ? [...textPaths, personText.namePath, personText.rolePath] : textPaths
    if (new Set(allPaths.map(normalizePathKey)).size !== allPaths.length) throw new Error('Fișierele TXT Headline și Person trebuie să fie distincte.')
    const contentNames = [buffers.A.contentName, buffers.B.contentName, name]
    if (new Set(contentNames).size !== contentNames.length) throw new Error('Numele contenturilor Headline trebuie să fie distincte între ele și față de Name.')
    normalizedHeadline = { mode: 'external-txt', buffers }
  } else {
    if (headline === name) throw new Error('Contenturile Headline și Name trebuie să aibă nume distincte.')
    const rawBuffers = objectPayload(headlineSettings.buffers)
    const readInactiveBuffer = (id: BufferId): HeadlineBufferConfig => {
      const item = objectPayload(rawBuffers[id])
      for (const key of ['contentName', 'kickerPath', 'titlePath'] as const) {
        if (typeof item[key] !== 'string' || (item[key] as string).length > 2000 || /[\x00-\x1f]/.test(item[key] as string)) throw new Error(`Configurația Headline ${id} este invalidă.`)
      }
      return { contentName: item.contentName as string, kickerPath: item.kickerPath as string, titlePath: item.titlePath as string }
    }
    normalizedHeadline = { mode: 'internal-json', buffers: { A: readInactiveBuffer('A'), B: readInactiveBuffer('B') } }
  }
  return { jsonDelayMs: payload.jsonDelayMs as LabSettings['jsonDelayMs'], headlineTransitionGapMs: transitionGapMs as LabSettings['headlineTransitionGapMs'], personDurationMs: personDurationMs as number, ...(personText ? { personText } : {}), contentNames: { headline, name }, headline: normalizedHeadline }
}

function textFilePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000 || /[\x00-\x1f]/.test(value)) throw new Error('Calea TXT trebuie să fie absolută și validă (locală sau UNC).')
  const result = value.trim()
  const windowsAbsolute = /^[a-z]:[\\/]/i.test(result) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(result)
  if (!windowsAbsolute) throw new Error('Calea TXT trebuie să fie absolută (cale Windows sau UNC).')
  if (!/\.txt$/i.test(result)) throw new Error('Fișierul trebuie să aibă extensia .txt.')
  return result
}

function normalizePathKey(value: string): string {
  const isUnc = /^(?:\\\\|\/\/)/.test(value)
  const slashed = value.replace(/[\\/]+/g, '/')
  const prefix = isUnc ? '//' : /^[a-z]:\//i.test(slashed) ? slashed.slice(0, 3).toLowerCase() : '/'
  const tail = isUnc ? slashed.slice(1) : prefix.length === 3 && prefix[1] === ':' ? slashed.slice(3) : slashed.slice(1)
  const parts: string[] = []
  for (const part of tail.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      const floor = prefix === '//' ? 2 : 0
      if (parts.length > floor) parts.pop()
    }
    else parts.push(part)
  }
  return `${prefix}${parts.join('/')}`.replace(/\/$/, '').toLocaleLowerCase('en-US')
}
