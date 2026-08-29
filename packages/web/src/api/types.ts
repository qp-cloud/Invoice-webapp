export interface ProductStock {
  qtyOnHand: string;
  status: 'normal' | 'low' | 'out';
  oversold: boolean;
  missingBalance: string;
  avgCostSatang: number;
}

export interface FyView {
  stock68: string;
  purchasesCfy: string;
  salesCfy: string;
  variance: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  unitCode: string;
  minStock: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  stock: ProductStock;
  fyView?: FyView;
}

export interface Page<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  fiscalYear?: number;
  labels?: { stock68: string; purchases: string; sales: string };
}

export interface Unit {
  code: string;
  nameTh: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Dashboard {
  fiscalYear: number;
  stock68Qty: string;
  purchasesCfyQty: string;
  purchasesCfyValueSatang: number;
  salesCfyQty: string;
  salesRevenueSatang: number;
  currentStockQty: string;
  estimatedCogsSatang: number;
  estimatedGrossProfitSatang: number;
  oversoldSkuCount: number;
  lowStockSkuCount: number;
  asOf: string;
}

export interface LedgerRow {
  id: string;
  seq: number;
  type: string;
  quantity: string;
  occurredOn: string;
  status: 'ACTIVE' | 'VOIDED';
  voidReason: string | null;
  unitCostSatang: number | null;
  runningBalance: string;
}

export interface LedgerResponse {
  rows: LedgerRow[];
  openingBalance: string;
  page: number;
  pageSize: number;
  total: number;
  currentStock: string;
}

export interface ProductStockDetail extends ProductStock {
  minStock: string;
  fyView: FyView;
}
