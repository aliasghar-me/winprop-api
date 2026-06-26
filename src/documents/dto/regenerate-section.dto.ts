import { IsIn } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { PROPOSAL_SECTIONS } from '../../llm/prompt.builder';

const SECTION_NAMES = Object.keys(PROPOSAL_SECTIONS);

export class RegenerateSectionDto {
  @IsIn(SECTION_NAMES, { message: i18nValidationMessage('validation.isIn') })
  section: string;
}
