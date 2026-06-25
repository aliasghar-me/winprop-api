import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { I18nContext, I18nValidationException } from 'nestjs-i18n';
import { AppException } from './app-exception.js';

// English fallback map — avoids JSON import issues with nodenext modules
// Keys are "errors.<keyName>" matching the translationKey format used in throw sites
const EN_FALLBACK: Record<string, string> = {
  'errors.llmNotConfigured': 'No LLM provider is configured. Ask the platform admin.',
  'errors.llmProviderUnavailable': 'Provider {provider} is not available.',
  'errors.llmGenerationFailed': 'Generation failed: {message}',
  'errors.llmUnreadable': 'The AI returned an unreadable response. Please try again.',
  'errors.llmIncomplete': 'The AI returned an incomplete response. Please try again.',
  'errors.emailInUse': 'Email already in use.',
  'errors.invalidCredentials': 'Invalid email or password.',
  'errors.invalidRefreshToken': 'Invalid refresh token.',
  'errors.accessRevoked': 'Access revoked.',
  'errors.roleForbidden': 'Your role cannot perform this action.',
  'errors.superAdminOnly': 'Super-admin only.',
  'errors.orgNotFound': 'Organization not found.',
  'errors.subscriptionInactive': 'Your subscription is inactive. Update payment to continue.',
  'errors.quotaExceeded': 'You have reached your plan limit of {limit} generations this period.',
  'errors.profileNotFound': 'Profile not found.',
  'errors.documentNotFound': 'Document not found.',
  'errors.jobNotFound': 'Job not found.',
  'errors.duplicateName': 'You already have a job named "{name}". Names must be unique.',
  'errors.invalidWebhookSignature': 'Invalid webhook signature.',
};

function interpolate(template: string, args?: Record<string, any>): string {
  if (!args) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(args[key] ?? `{${key}}`));
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    // H8: I18nValidationPipe throws this with already-localized constraint messages.
    // Flatten them into our standard { statusCode, code, message } envelope.
    if (exception instanceof I18nValidationException) {
      const messages = this.collectConstraints(exception.errors ?? []);
      return res.status(400).json({
        statusCode: 400,
        code: 'VALIDATION',
        message: messages.join(', ') || 'Validation failed',
      });
    }

    if (exception instanceof AppException) {
      const status = exception.getStatus();
      const i18n = I18nContext.current();
      let message: string | undefined;
      if (i18n) {
        try {
          const translated = i18n.translate(exception.translationKey, { args: exception.args });
          // nestjs-i18n returns the key unchanged when translation is missing; result may be {} on miss
          const translatedStr = typeof translated === 'string' ? translated : undefined;
          if (translatedStr && translatedStr !== exception.translationKey) {
            message = translatedStr;
          }
        } catch {
          // i18n not ready in some unit-test contexts — fall through to EN_FALLBACK
        }
      }
      if (!message) {
        const template = EN_FALLBACK[exception.translationKey] ?? exception.translationKey;
        message = interpolate(template, exception.args);
      }
      return res.status(status).json({ statusCode: status, code: exception.code, message });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      const code = body.code ?? this.defaultCode(status);
      const message = Array.isArray(body.message) ? body.message.join(', ')
        : (body.message ?? exception.message);
      return res.status(status).json({ statusCode: status, code, message });
    }

    return res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Internal error' });
  }

  // Depth-first collect of translated constraint strings across nested errors.
  private collectConstraints(errors: any[]): string[] {
    const out: string[] = [];
    for (const e of errors) {
      if (e?.constraints) out.push(...Object.values<string>(e.constraints));
      if (e?.children?.length) out.push(...this.collectConstraints(e.children));
    }
    return out;
  }

  private defaultCode(status: number) {
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 400) return 'VALIDATION';
    return 'ERROR';
  }
}
