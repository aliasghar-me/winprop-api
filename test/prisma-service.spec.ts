import { PrismaService } from '../src/prisma/prisma.service';

// Unit-only: construct the service (no real DB connection is opened until
// $connect), stub the client's connect/disconnect, and drive the lifecycle hooks.
describe('PrismaService lifecycle', () => {
  it('onModuleInit connects and onModuleDestroy disconnects', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined as never);
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined as never);

    await svc.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);

    await svc.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('exposes a tenant-scoped extended client (db)', () => {
    const svc = new PrismaService();
    expect(svc.db).toBeDefined();
  });
});
