export interface ProductStock {
  qtyOnHand: string;
  status: 'normal' | 'low' | 'out';
  oversold: boolean;
  missingBalance: string;
  avgCostSatang: number;
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
}

export interface Page<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Unit {
  code: string;
  nameTh: string;
}
