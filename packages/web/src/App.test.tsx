import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App.js';

const dashboard = {
  fiscalYear: 2569,
  stock68Qty: '113',
  purchasesCfyQty: '50',
  purchasesCfyValueSatang: 6_000_000,
  salesCfyQty: '45',
  salesRevenueSatang: 7_350_000,
  currentStockQty: '118',
  estimatedCogsSatang: 3_000_000,
  estimatedGrossProfitSatang: 4_350_000,
  oversoldSkuCount: 1,
  lowStockSkuCount: 1,
  asOf: '2026-08-29T12:00:00Z',
};

const productsPage = {
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
      fyView: { stock68: '1000', purchasesCfy: '8000', salesCfy: '7700', variance: '300' },
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
  fiscalYear: 2569,
  labels: { stock68: 'Stock 69', purchases: 'ซื้อเข้า 69', sales: 'ขายออก 69' },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      let body: unknown = {};
      if (url.includes('/dashboard')) body = dashboard;
      else if (url.includes('/products')) body = productsPage;
      else if (url.includes('/units')) body = [{ code: 'piece', nameTh: 'ชิ้น' }];
      else if (url.includes('/categories')) body = [];
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch,
  );
});
afterEach(() => vi.unstubAllGlobals());

it('shows the dashboard KPI cards, then the master stock table', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'แดชบอร์ด' })).toBeInTheDocument());
  expect(screen.getByText('สต็อกยกมา (Stock 68)')).toBeInTheDocument();
  expect(screen.getByText('SKU ขายเกินสต็อก')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'สต็อก' }));
  expect(screen.getByRole('heading', { name: 'สินค้า (Master)' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('SKU-001')).toBeInTheDocument());
  expect(screen.getAllByText('🟢 ปกติ').length).toBeGreaterThan(0);
  expect(screen.getByText('1,300')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Stock 69' })).toBeInTheDocument();
});
