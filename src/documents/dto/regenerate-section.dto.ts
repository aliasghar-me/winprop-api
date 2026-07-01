import { IsIn } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PROPOSAL_SECTIONS } from '../../llm/prompt.builder';
import { DOC_TEMPLATES } from '../../llm/doc-templates';

// Proposal section names ∪ every registry doc-type field key (dedup).
const SECTION_NAMES = [
  ...new Set([
    ...Object.keys(PROPOSAL_SECTIONS),
    ...Object.values(DOC_TEMPLATES).flatMap((t) => t.fields.map((f) => f.key)),
  ]),
];

export class RegenerateSectionDto {
  @IsIn(SECTION_NAMES, { message: i18nValidationMessage('validation.isIn') })
  section: string;
}
