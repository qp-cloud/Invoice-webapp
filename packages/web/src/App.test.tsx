import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App.js';

const products = {
  rows: [
    {
      id: '1',
      sku: 'SKU-001',
      name: 'สินค้า A',
      categoryId: null,
      unitCode: 'piece',
      minStock: '500',
      active: true,
      createdAt: '',
      updatedAt: '',
      stock: { qtyOnHand: '1300', status: 'normal', oversold: false, missingBalance: '0', avgCostSatang: 0 },
    },
  ],
  page: 1,
  pageSize: 100,
  total: 1,
  totalPages: 1,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.includes('/units') ? [{ code: 'piece', nameTh: 'ชิ้น' }] : products),
    })) as unknown as typeof fetch,
  );
});
afterEach(() => vi.unstubAllGlobals());

it('renders the products page with a row from the API', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'สินค้า (Master)' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('SKU-001')).toBeInTheDocument());
  expect(screen.getByText('🟢 ปกติ')).toBeInTheDocument();
  expect(screen.getByText('1,300')).toBeInTheDocument();
});
