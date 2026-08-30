import type { Queryable } from '../db/client.js';
import { getCompanyProfile } from './companyProfile.js';

export type VatReportKind = 'purchase' | 'sales';

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
  kind: VatReportKind;
  ym: string;
  company: Awaited<ReturnType<typeof getCompanyProfile>>;
  rows: VatReportRow[];
  totals: { netSatang: number; vatSatang: number; totalSatang: number; count: number };
}

/**
 * รายงานภาษีซื้อ / รายงานภาษีขาย for a month (ภ.พ.30 filing). Lists every CONFIRMED
 * invoice of the kind whose issue date falls in the month; VOID invoices are excluded
 * from the figures (they carry no tax point).
 */
export async function vatReport(db: Queryable, kind: VatReportKind, ym: string): Promise<VatReport> {
  const docType = kind === 'purchase' ? 'BUY' : 'SELL';
  const start = `${ym}-01`;
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const { rows } = await db.query<{
    issue_date: string;
    invoice_number: string;
    contact_name_snapshot: string | null;
    contact_tax_id_snapshot: string | null;
    contact_branch_snapshot: string | null;
    subtotal_satang: string;
    vat_satang: string;
    total_satang: string;
  }>(
    `SELECT issue_date, invoice_number, contact_name_snapshot, contact_tax_id_snapshot,
            contact_branch_snapshot, subtotal_satang, vat_satang, total_satang
     FROM invoices
     WHERE doc_type = $1 AND status = 'CONFIRMED'
       AND issue_date >= $2::date AND issue_date < $3::date
     ORDER BY issue_date, invoice_number`,
    [docType, start, end],
  );

  let net = 0;
  let vat = 0;
  let total = 0;
  const reportRows: VatReportRow[] = rows.map((r, i) => {
    const n = Number(r.subtotal_satang);
    const v = Number(r.vat_satang);
    const t = Number(r.total_satang);
    net += n;
    vat += v;
    total += t;
    return {
      seq: i + 1,
      issueDate: r.issue_date,
      invoiceNumber: r.invoice_number,
      contactName: r.contact_name_snapshot ?? '',
      contactTaxId: r.contact_tax_id_snapshot,
      contactBranch: r.contact_branch_snapshot,
      netSatang: n,
      vatSatang: v,
      totalSatang: t,
    };
  });

  return {
    kind,
    ym,
    company: await getCompanyProfile(db),
    rows: reportRows,
    totals: { netSatang: net, vatSatang: vat, totalSatang: total, count: reportRows.length },
  };
}
