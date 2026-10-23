import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: mocks, functions: { invoke: mocks.invoke } } }));
import { vipPublishRequest } from './vipPublishRequest';

describe('VIP action recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'current' } }, error: null });
  });
  it('retries a 401 once with a refreshed session and the same action', async () => {
    const body = { action: 'set_status', product_ids: ['product'], status: 'unavailable' };
    mocks.invoke.mockResolvedValueOnce({ error: { context: new Response('{}', { status: 401 }) } }).mockResolvedValueOnce({ data: { ok: true } });
    mocks.refreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh' } }, error: null });
    await vipPublishRequest(body);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith('vip-publish', { body, headers: { Authorization: 'Bearer fresh' } });
  });
  it('preserves publish validation details without retrying the mutation', async () => {
    mocks.invoke.mockResolvedValue({ error: { context: new Response(JSON.stringify({ error: 'products_not_publishable', message: 'Shipping rate missing' }), { status: 422 }) } });
    await expect(vipPublishRequest({ action: 'publish' })).rejects.toThrow('Shipping rate missing');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
  it('does not invoke product actions without a signed-in session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(vipPublishRequest({ action: 'delete' })).rejects.toThrow('Please sign in again');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});