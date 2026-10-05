import type { LabSnapshot, TemplateType } from '@/shared/lab/contracts'

export interface PreviewGraphic {
  type: TemplateType
  primary: string
  secondary: string
}

/** Resolve only committed active-buffer text; renderer edit fields are deliberately ignored. */
export function selectPreviewGraphic(snapshot: LabSnapshot): PreviewGraphic | null {
  const active = snapshot.activationOrder?.filter(type => snapshot.templates[type]?.activeBuffer !== null) ?? []
  const fallback: TemplateType[] = active.length
    ? active.slice().reverse()
    : (['name', 'headline'] as const).filter(type => snapshot.templates[type]?.activeBuffer !== null)
  for (const type of fallback) {
    const template = snapshot.templates[type]
    const buffer = template?.activeBuffer
    if (!buffer) continue
    const fields = template.bufferFields[buffer]
    if (!fields) continue
    return { type, primary: fields.primary, secondary: fields.secondary }
  }
  return null
}
