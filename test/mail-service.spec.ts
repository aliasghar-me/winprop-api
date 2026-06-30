const send = jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null });
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send } })) }));

import { MailService } from '../src/mail/mail.service';

describe('MailService', () => {
  const OLD = { ...process.env };
  beforeEach(() => { send.mockClear(); });
  afterEach(() => { process.env = { ...OLD }; });

  it('sends via Resend when RESEND_API_KEY + MAIL_FROM are configured', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.MAIL_FROM = 'WinProp <no-reply@winprop.ai>';
    await new MailService().sendVerificationEmail('user@example.com', 'https://app/verify-email?token=abc');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'WinProp <no-reply@winprop.ai>',
      to: 'user@example.com',
      subject: expect.stringContaining('Verify'),
      text: expect.stringContaining('verify-email?token=abc'),
    }));
  });

  it('does not call the provider when unconfigured (dev-log fallback)', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    process.env.NODE_ENV = 'development';
    await new MailService().sendVerificationEmail('user@example.com', 'https://app/verify-email?token=abc');
    expect(send).not.toHaveBeenCalled();
  });
});
