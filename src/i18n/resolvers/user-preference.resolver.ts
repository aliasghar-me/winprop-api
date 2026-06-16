import { Injectable, ExecutionContext } from '@nestjs/common';
import { I18nResolver } from 'nestjs-i18n';

@Injectable()
export class UserPreferenceResolver implements I18nResolver {
  resolve(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();
    return req?.user?.preferredLanguage ?? undefined;
  }
}
