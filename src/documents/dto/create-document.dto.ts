import { IsIn, IsOptional } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

const TYPES = ['proposal', 'sow', 'estimate'];

export class CreateDocumentDto {
  @IsOptional()
  @IsIn(TYPES, { message: i18nValidationMessage('validation.isIn') })
  type?: string;
}
