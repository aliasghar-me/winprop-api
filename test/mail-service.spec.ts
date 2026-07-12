const send = jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null });
const ResendCtor = jest.fn().mockImplementation(() => ({ emails: { send } }));
jest.mock('resend', () => ({ Resend: ResendCtor }));

import { MailService } from '../src/mail/mail.service';
import { Logger } from '@nestjs/common';

describe('MailService', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    send.mockClear();
    send.mockResolvedValue({ data: { id: 'x' }, error: null });
    ResendCtor.mockClear();
  });
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  it('sends via Resend when RESEND_API_KEY + MAIL_FROM are configured', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'WinProp <no-reply@winprop.ai>';
    await new MailService().sendVerificationEmail('user@example.com', 'https://app/verify-email?token=abc');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'WinProp <no-reply@winprop.ai>',
        to: 'user@example.com',
        subject: expect.stringContaining('Verify'),
        text: expect.stringContaining('verify-email?token=abc'),
      }),
    );
  });

  it('reuses a single Resend client across multiple sends', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'a@b.co';
    const svc = new MailService();
    await svc.sendVerificationEmail('one@example.com', 'https://app/v?1');
    await svc.sendVerificationEmail('two@example.com', 'https://app/v?2');
    expect(send).toHaveBeenCalledTimes(2);
    expect(ResendCtor).toHaveBeenCalledTimes(1); // lazily created once, then cached
  });

  it('logs an error when Resend returns an error object (with message)', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'a@b.co';
    send.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await new MailService().sendVerificationEmail('user@example.com', 'https://app/v');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
  });

  it('logs an error when Resend returns an error without a message', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'a@b.co';
    send.mockResolvedValueOnce({ data: null, error: { name: 'weird' } });
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await new MailService().sendVerificationEmail('user@example.com', 'https://app/v');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Mail send failed'));
  });

  it('swallows a transport throw and logs it (never breaks the caller)', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'a@b.co';
    send.mockRejectedValueOnce(new Error('network down'));
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(
      new MailService().sendVerificationEmail('user@example.com', 'https://app/v'),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });

  it('handles a non-Error transport throw (String(e) branch)', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'a@b.co';
    send.mockRejectedValueOnce('plain string failure');
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(
      new MailService().sendVerificationEmail('user@example.com', 'https://app/v'),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('plain string failure'));
  });

  it('warns loudly in production when no transport is configured', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    process.env.NODE_ENV = 'production';
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await new MailService().sendVerificationEmail('user@example.com', 'https://app/v');
    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No mail transport configured'));
  });

  it('dev-logs when unconfigured outside production', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    process.env.NODE_ENV = 'development';
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await new MailService().sendVerificationEmail('user@example.com', 'https://app/v');
    expect(send).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[dev mail]'));
  });

  it('treats a missing MAIL_FROM (key set, from unset) as unconfigured', async () => {
    process.env.RESEND_API_KEY = 're_test';
    delete process.env.MAIL_FROM;
    process.env.NODE_ENV = 'development';
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await new MailService().sendVerificationEmail('user@example.com', 'https://app/v');
    expect(send).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});
