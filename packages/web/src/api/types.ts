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

export interface MonthlyReportRow {
  productId: string;
  sku: string;
  name: string;
  openingQty: string;
  purchasesQty: string;
  purchasesValueSatang: number;
  salesQty: string;
  salesRevenueSatang: number;
  estimatedCogsSatang: number;
  estimatedGrossProfitSatang: number;
  grossMarginPct: number | null;
  closingQty: string;
}

export interface MonthlyReport {
  ym: string;
  rows: MonthlyReportRow[];
  totals: {
    purchasesValueSatang: number;
    salesRevenueSatang: number;
    estimatedCogsSatang: number;
    estimatedGrossProfitSatang: number;
    grossMarginPct: number | null;
  };
}

export interface LowStockRow {
  productId: string;
  sku: string;
  name: string;
  qtyOnHand: string;
  minStock: string;
  shortfall: string;
}

export interface OversoldRow {
  productId: string;
  sku: string;
  name: string;
  qtyOnHand: string;
  missingBalance: string;
}

export interface Backup {
  id: string;
  createdAt: string;
  kind: 'AUTO' | 'MANUAL' | 'PRE_RESTORE';
  sizeBytes: number;
  schemaVersion: string;
  appVersion: string;
  pgVersion: string;
  localStatus: string;
  cloudStatus: string;
  verifiedAt: string | null;
  rowCounts: Record<string, number>;
}

export interface BackupStatus {
  lastBackupAt: string | null;
  verifiedCount: number;
  latest: Backup | null;
}

// ---- tax invoices (module 0004) ----
export interface Contact {
  id: string;
  kind: 'SUPPLIER' | 'CUSTOMER' | 'BOTH';
  name: string;
  taxId: string | null;
  branch: string | null;
  address: string | null;
  phone: string | null;
  note: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  docType: 'BUY' | 'SELL';
  invoiceNumber: string | null;
  contactId: string;
  issueDate: string;
  status: 'DRAFT' | 'CONFIRMED' | 'VOID';
  subtotalSatang: number;
  vatSatang: number;
  totalSatang: number;
  totalCogsSatang: number | null;
  contactNameSnapshot: string | null;
  contactTaxIdSnapshot: string | null;
  contactBranchSnapshot: string | null;
  contactAddressSnapshot: string | null;
  referenceNo: string | null;
  note: string | null;
  confirmedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListRow extends Invoice {
  contactName: string;
}

export interface InvoiceLine {
  id: string;
  lineNo: number;
  productId: string;
  productSku?: string;
  productName?: string;
  description: string | null;
  quantity: string;
  unitPriceSatang: number;
  vatRate: number;
  lineNetSatang: number;
  lineVatSatang: number;
  lineTotalSatang: number;
}

export interface CompanyProfile {
  name: string;
  nameEn: string;
  taxId: string;
  branch: string;
  address: string;
  phone: string;
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: InvoiceLine[];
  contact: Contact | null;
  company: CompanyProfile;
}

export interface VatReportRow {
  seq: number;
  issueDate: string;
  invoiceNumber: string;
  contactName: string;
  contactTaxId: string | null;
  contactBranch: string | null;
  netSatang: number;
  vatSatang: number;
  totalSatang: number;
}

export interface VatReport {
  kind: 'purchase' | 'sales';
  ym: string;
  company: CompanyProfile;
  rows: VatReportRow[];
  totals: { netSatang: number; vatSatang: number; totalSatang: number; count: number };
}
