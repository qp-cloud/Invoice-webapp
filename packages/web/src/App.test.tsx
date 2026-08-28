import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App.js';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ ok: true, db: 'up', schemaVersion: '0003_periods_fy2569', appVersion: '0.0.0' }),
    })) as unknown as typeof fetch,
  );
});
afterEach(() => vi.unstubAllGlobals());

it('renders the app title and shows health once loaded', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'ระบบจัดการสต็อกสินค้า' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Schema: 0003_periods_fy2569')).toBeInTheDocument());
});
