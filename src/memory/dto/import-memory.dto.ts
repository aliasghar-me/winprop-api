import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { i18nValidationMessage } from 'nestjs-i18n';

const m = (k: string) => i18nValidationMessage(k);

// One fact in an import payload. Same shape as the export dump so an export can be
// re-imported. category/key/value required; the rest optional (defaults applied in
// MemoryService.import via recordFact).
export class ImportedFact {
  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(100, { message: m('validation.maxLength') })
  category: string;

  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(200, { message: m('validation.maxLength') })
  key: string;

  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(5000, { message: m('validation.maxLength') })
  value: string;

  @IsOptional()
  @IsNumber({}, { message: m('validation.isNumber') })
  @Min(0, { message: m('validation.min') })
  @Max(1, { message: m('validation.max') })
  confidence?: number;

  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(60, { message: m('validation.maxLength') }) source?: string;
  @IsOptional() @IsBoolean({ message: m('validation.isBoolean') }) sensitive?: boolean;
  @IsOptional() @IsBoolean({ message: m('validation.isBoolean') }) isPermanent?: boolean;
}

export class ImportMemoryDto {
  @IsArray({ message: m('validation.isArray') })
  @ArrayMaxSize(500, { message: m('validation.arrayMaxSize') })
  @ValidateNested({ each: true })
  @Type(() => ImportedFact)
  facts: ImportedFact[];
}
