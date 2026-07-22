import { UsersController } from '../src/users/users.controller';
import { NotFoundException } from '@nestjs/common';

// Unit-only: drive UsersController with fake Prisma + Crypto. No app/DI.

describe('UsersController', () => {
  describe('me', () => {
    it('returns the decrypted current user with emailVerified=true when verified', async () => {
      const prisma: any = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1', email: 'enc-email', name: 'enc-name', emailVerifiedAt: new Date(),
          }),
        },
      };
      const crypto: any = { decryptSafe: jest.fn((v: string) => `dec(${v})`) };
      const ctrl = new UsersController(prisma, crypto);
      const out = await ctrl.me({ userId: 'u1' } as any);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
      expect(out).toEqual({ id: 'u1', email: 'dec(enc-email)', name: 'dec(enc-name)', emailVerified: true });
    });

    it('returns emailVerified=false when emailVerifiedAt is null', async () => {
      const prisma: any = {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u2', email: 'e', name: 'n', emailVerifiedAt: null }) },
      };
      const crypto: any = { decryptSafe: jest.fn((v: string) => v) };
      const ctrl = new UsersController(prisma, crypto);
      const out = await ctrl.me({ userId: 'u2' } as any);
      expect(out.emailVerified).toBe(false);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
      const crypto: any = { decryptSafe: jest.fn() };
      const ctrl = new UsersController(prisma, crypto);
      await expect(ctrl.me({ userId: 'missing' } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(crypto.decryptSafe).not.toHaveBeenCalled();
    });
  });

  describe('setLanguage', () => {
    it('updates the preferred language and echoes it back', async () => {
      const prisma: any = { user: { update: jest.fn().mockResolvedValue({}) } };
      const ctrl = new UsersController(prisma, {} as any);
      const out = await ctrl.setLanguage({ userId: 'u1' } as any, { language: 'ar' } as any);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { preferredLanguage: 'ar' },
      });
      expect(out).toEqual({ ok: true, language: 'ar' });
    });
  });
});
