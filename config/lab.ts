import type { GraphicItem, LabSettings } from '../src/shared/lab/contracts'

// Values supplied from the user's LiveBoard OSC settings. Outbound sender != receiver.
export const LAB_CONNECTION = {
  host: 'localhost', port: 501, baseAddress: '/lvb/control/', liveBoardSenderHost: 'localhost:601',
} as const
// LiveBoard manual §3.6.2.5 and MikOfClassX/LiveBoard-CuePilot-schema.
export const OSC_ADDRESSES = {
  play: '/lvb/control/play', stop: '/lvb/control/stop', pause: '/lvb/control/pause',
  resume: '/lvb/control/resume', stopall: '/lvb/control/stopall', lbcontrol: '/lvb/control/lbcontrol',
} as const
export const DEFAULT_LAB_SETTINGS: LabSettings = {
  jsonDelayMs: 250, headlineTransitionGapMs: 100, personDurationMs: 5000, contentNames: { headline: 'L3_HEADLINE', name: 'L3_NAME' },
}
export function defaultExternalTxtSettings(outputDirectory: string): LabSettings {
  const separator = outputDirectory.includes('\\') || /^[a-z]:/i.test(outputDirectory) ? '\\' : '/'
  const file = (name: string) => `${outputDirectory.replace(/[\\/]+$/, '')}${separator}${name}`
  const headline = {
    mode: 'external-txt' as const,
    buffers: {
      A: { contentName: '01_X_Titlu1', kickerPath: file('PA_Supratitlu_1.txt'), titlePath: file('PA_Title_1.txt') },
      B: { contentName: '01_x_Titlu2', kickerPath: file('PA_Supratitlu_2.txt'), titlePath: file('PA_Title_2.txt') },
    },
  }
  return {
    jsonDelayMs: 250, headlineTransitionGapMs: 100, personDurationMs: 5000,
    contentNames: { headline: 'L3_HEADLINE', name: 'L3_NAME' }, headline,
    personText: { namePath: file('PA_Person_Name.txt'), rolePath: file('PA_Person_Role.txt') },
  }
}
export const LAB_PRESETS: GraphicItem[] = [
  { id: 'headline-1', templateType: 'headline', label: 'Titlu 1', fields: { primary: 'CONFLICTUL POLITIC TRENEAZĂ', secondary: 'Liderii politici, în tensiune maximă și fără un acord politic' } },
  { id: 'headline-2', templateType: 'headline', label: 'Titlu 2', fields: { primary: 'BLOCAJ POLITIC MAJOR', secondary: 'Azi e ultima zi a sesiunii parlamentare. Deputații și senatorii intră în vacanță' } },
  { id: 'headline-3', templateType: 'headline', label: 'Titlu 3 · același kicker, alt titlu', fields: { primary: 'BLOCAJ POLITIC MAJOR', secondary: 'Președintele Dan așteaptă o flexibilizare de la partide' } },
  { id: 'headline-4', templateType: 'headline', label: 'Titlu 4 · diacritice', fields: { primary: 'TEST LAB — Ă Â Î Ș Ț', secondary: 'Verificare text lung, spații și actualizare simultană a celor două câmpuri' } },
  // First name/role is a historical graphic sample from the user's reference frames, not a current office claim.
  { id: 'name-1', templateType: 'name', label: 'Nume 1 · referință captură', fields: { primary: 'Ilie Bolojan', secondary: 'prim-ministrul României' } },
  { id: 'name-2', templateType: 'name', label: 'Nume 2 · test fictiv', fields: { primary: 'Ana Popescu', secondary: 'prezentatoare' } },
  { id: 'name-3', templateType: 'name', label: 'Nume 3 · test fictiv', fields: { primary: 'Ștefan Ionescu', secondary: 'corespondent' } },
]
export const INITIAL_JSON = {
  headline: { KICKER_A: '', TITLE_A: '', KICKER_B: '', TITLE_B: '' },
  name: { NAME_A: '', ROLE_A: '', NAME_B: '', ROLE_B: '' },
}
