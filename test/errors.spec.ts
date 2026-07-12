import { HttpException, BadRequestException } from '@nestjs/common';
import { I18nValidationException, I18nContext } from 'nestjs-i18n';
import { AppException } from '../src/common/errors/app-exception';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

function makeHost() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host: any = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
  return { host, status, json };
}

describe('AppException', () => {
  it('carries status, code, translationKey and args', () => {
    const ex = new AppException(404, 'NOT_FOUND', 'errors.orgNotFound', { id: 'x' });
    expect(ex).toBeInstanceOf(HttpException);
    expect(ex.getStatus()).toBe(404);
    expect(ex.code).toBe('NOT_FOUND');
    expect(ex.translationKey).toBe('errors.orgNotFound');
    expect(ex.args).toEqual({ id: 'x' });
    expect(ex.getResponse()).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', translationKey: 'errors.orgNotFound' });
  });
});

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  afterEach(() => jest.restoreAllMocks());

  it('uses the active i18n translation when one is available', () => {
    jest.spyOn(I18nContext, 'current').mockReturnValue({
      translate: () => 'Localized message!',
    } as any);
    const { host, json } = makeHost();
    filter.catch(new AppException(404, 'NOT_FOUND', 'errors.orgNotFound'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Localized message!' }));
  });

  it('falls back to EN when i18n returns the key unchanged (missing translation)', () => {
    jest.spyOn(I18nContext, 'current').mockReturnValue({
      translate: (k: string) => k, // nestjs-i18n returns the key on a miss
    } as any);
    const { host, json } = makeHost();
    filter.catch(new AppException(404, 'NOT_FOUND', 'errors.orgNotFound'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Organization not found.' }));
  });

  it('falls back to EN when i18n.translate throws', () => {
    jest.spyOn(I18nContext, 'current').mockReturnValue({
      translate: () => { throw new Error('i18n not ready'); },
    } as any);
    const { host, json } = makeHost();
    filter.catch(new AppException(404, 'NOT_FOUND', 'errors.orgNotFound'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Organization not found.' }));
  });

  it('maps an AppException via the EN fallback and interpolates args', () => {
    const { host, status, json } = makeHost();
    filter.catch(new AppException(429, 'QUOTA_EXCEEDED', 'errors.quotaExceeded', { limit: 50 }), host);
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      statusCode: 429,
      code: 'QUOTA_EXCEEDED',
      message: 'You have reached your plan limit of 50 generations this period.',
    });
  });

  it('falls back to the raw translationKey when unknown', () => {
    const { host, json } = makeHost();
    filter.catch(new AppException(400, 'VALIDATION', 'errors.totallyUnknownKey'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'errors.totallyUnknownKey' }));
  });

  it('flattens an I18nValidationException (including nested children) into a 400 envelope', () => {
    const { host, status, json } = makeHost();
    const ex = new I18nValidationException([
      { property: 'email', constraints: { isEmail: 'email must be valid' }, children: [] },
      {
        property: 'address',
        children: [{ property: 'zip', constraints: { isPostal: 'zip invalid' }, children: [] }],
      },
    ] as any);
    filter.catch(ex, host);
    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('VALIDATION');
    expect(body.message).toContain('email must be valid');
    expect(body.message).toContain('zip invalid');
  });

  it('maps a generic HttpException using the default code table', () => {
    const { host, status, json } = makeHost();
    filter.catch(new BadRequestException('bad input'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION', message: 'bad input' }));
  });

  it('joins array messages from an HttpException body', () => {
    const { host, json } = makeHost();
    filter.catch(new HttpException({ message: ['a', 'b'] }, 403), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN', message: 'a, b' }));
  });

  it('derives the default code from the status for a bare HttpException', () => {
    const cases: [number, string][] = [
      [401, 'UNAUTHORIZED'],
      [404, 'NOT_FOUND'],
      [418, 'ERROR'],
    ];
    for (const [statusCode, code] of cases) {
      const { host, json } = makeHost();
      filter.catch(new HttpException('x', statusCode), host);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code }));
    }
  });

  it('returns a 500 INTERNAL envelope for a non-HttpException', () => {
    const { host, status, json } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, code: 'INTERNAL', message: 'Internal error' });
  });
});
