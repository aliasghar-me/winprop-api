import { clientIp } from '../src/common/net/client-ip';

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, ip: '10.0.0.1' } as any)).toBe('203.0.113.5');
  });

  it('trims a single-value x-forwarded-for', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '  198.51.100.2  ' } } as any)).toBe('198.51.100.2');
  });

  it('falls back to req.ip when x-forwarded-for is empty/whitespace', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '   ' }, ip: '1.2.3.4' } as any)).toBe('1.2.3.4');
  });

  it('falls back to req.ip when there is no forwarded header', () => {
    expect(clientIp({ headers: {}, ip: '5.6.7.8' } as any)).toBe('5.6.7.8');
  });

  it('handles a missing headers object', () => {
    expect(clientIp({ ip: '9.9.9.9' } as any)).toBe('9.9.9.9');
  });

  it('falls back to the socket remote address when req.ip is absent', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '10.10.10.10' } } as any)).toBe('10.10.10.10');
  });

  it('returns "unknown" when nothing is available', () => {
    expect(clientIp({ headers: {} } as any)).toBe('unknown');
  });
});
