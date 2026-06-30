import { CoverTemplate } from './_shared'
import { diagonal } from './diagonal'
import { blocks } from './blocks'
import { minimal } from './minimal'
import { sidebar } from './sidebar'
import { gradient } from './gradient'
import { editorial } from './editorial'

export * from './_shared'

export const COVER_TEMPLATES: CoverTemplate[] = [diagonal, blocks, minimal, sidebar, gradient, editorial]

export function getTemplate(id: string): CoverTemplate {
  return COVER_TEMPLATES.find(t => t.id === id) ?? COVER_TEMPLATES[0]
}
