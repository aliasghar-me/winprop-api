import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { Profession } from '@prisma/client';

export class SignupDto {
  @IsEmail() email: string;
  @MinLength(8) password: string;
  @IsString() name: string;
  @IsString() agencyName: string;
  @IsEnum(Profession) profession: Profession;
}
