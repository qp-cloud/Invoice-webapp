import { randomUUID } from 'node:crypto';
import {
  addSatang,
  AppError,
  asSatang,
  computeLine,
  type CreateInvoiceInput,
  Decimal,
  type InvoiceLineInput,
  type ListInvoicesQuery,
  sumInvoice,
  type UpdateInvoiceInput,
  type VatRate,
} from '@inventory/shared';
import type { Database, Queryable } from '../db/client.js';
import { camelize, camelizeRows } from '../db/rows.js';
import { writeAudit } from './audit.js';
import { assertContactForDoc, getContact } from './contacts.js';
import { assertActiveCompanyProfile, getCompanyProfile } from './companyProfile.js';
import { type IdempotentResult, runIdempotent } from './idempotency.js';
import { postMovementTx, recomputeStockState } from './ledger.js';
import { assertPeriodOpen } from './periods.js';
import { getNegativeStockMode } from './settings.js';

type DocType = 'BUY' | 'SELL';

export interface InvoiceLine {
  id: string;
  lineNo: number;
  productId: string;
  productSku?: string;
  productName?: string;
  productUnit?: string;
  description: string | null;
  quantity: string;
  unitPriceSatang: number;
  vatRate: number;
  lineNetSatang: number;
  lineVatSatang: number;
  lineTotalSatang: number;
}

export interface Invoice {
  id: string;
  docType: DocType;
  invoiceNumber: string | null;
  companyProfileId: string;
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
  companyNameSnapshot: string | null;
  companyNameEnSnapshot: string | null;
  companyTaxIdSnapshot: string | null;
  companyBranchSnapshot: string | null;
  companyAddressSnapshot: string | null;
  companyPhoneSnapshot: string | null;
  referenceNo: string | null;
  note: string | null;
  attention: string | null;
  salesperson: string | null;
  dueDate: string | null;
  paymentMethod: 'CHEQUE' | 'TRANSFER' | 'CASH' | null;
  bankName: string | null;
  bankBranch: string | null;
  chequeNo: string | null;
  paymentDate: string | null;
  paymentAmountSatang: number | null;
  collector: string | null;
  confirmedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
}

const num = (v: unknown): number => Number(v ?? 0);

function shapeInvoice(r: Record<string, unknown>): Invoice {
  const c = camelize<Record<string, unknown>>(r);
  return {
    id: c.id as string,
    docType: c.docType as DocType,
    invoiceNumber: (c.invoiceNumber as string | null) ?? null,
    companyProfileId: c.companyProfileId as string,
    contactId: c.contactId as string,
    issueDate: c.issueDate as string,
    status: c.status as Invoice['status'],
    subtotalSatang: num(c.subtotalSatang),
    vatSatang: num(c.vatSatang),
    totalSatang: num(c.totalSatang),
    totalCogsSatang: c.totalCogsSatang == null ? null : num(c.totalCogsSatang),
    contactNameSnapshot: (c.contactNameSnapshot as string | null) ?? null,
    contactTaxIdSnapshot: (c.contactTaxIdSnapshot as string | null) ?? null,
    contactBranchSnapshot: (c.contactBranchSnapshot as string | null) ?? null,
    contactAddressSnapshot: (c.contactAddressSnapshot as string | null) ?? null,
    companyNameSnapshot: (c.companyNameSnapshot as string | null) ?? null,
    companyNameEnSnapshot: (c.companyNameEnSnapshot as string | null) ?? null,
    companyTaxIdSnapshot: (c.companyTaxIdSnapshot as string | null) ?? null,
    companyBranchSnapshot: (c.companyBranchSnapshot as string | null) ?? null,
    companyAddressSnapshot: (c.companyAddressSnapshot as string | null) ?? null,
    companyPhoneSnapshot: (c.companyPhoneSnapshot as string | null) ?? null,
    referenceNo: (c.referenceNo as string | null) ?? null,
    note: (c.note as string | null) ?? null,
    attention: (c.attention as string | null) ?? null,
    salesperson: (c.salesperson as string | null) ?? null,
    dueDate: (c.dueDate as string | null) ?? null,
    paymentMethod: (c.paymentMethod as Invoice['paymentMethod']) ?? null,
    bankName: (c.bankName as string | null) ?? null,
    bankBranch: (c.bankBranch as string | null) ?? null,
    chequeNo: (c.chequeNo as string | null) ?? null,
    paymentDate: (c.paymentDate as string | null) ?? null,
    paymentAmountSatang: c.paymentAmountSatang == null ? null : num(c.paymentAmountSatang),
    collector: (c.collector as string | null) ?? null,
    confirmedAt: (c.confirmedAt as string | null) ?? null,
    voidedAt: (c.voidedAt as string | null) ?? null,
    voidReason: (c.voidReason as string | null) ?? null,
    createdAt: c.createdAt as string,
    updatedAt: c.updatedAt as string,
  };
}

/** Recompute + persist all lines of a DRAFT invoice and roll up the header totals. */
async function replaceLines(
  tx: Queryable,
  invoiceId: string,
  lines: InvoiceLineInput[],
): Promise<void> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const prod = await tx.query<{ id: string; name: string }>(
    `SELECT id, name FROM products WHERE id = ANY($1)`,
    [productIds],
  );
  const known = new Map(prod.rows.map((r) => [r.id, r.name]));
  for (const id of productIds) {
    if (!known.has(id)) throw new AppError('NOT_FOUND', { userMessage: `ไม่พบสินค้า ${id}` });
  }

  await tx.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);

  const money = lines.map((l) => computeLine(asSatang(l.unitPriceSatang), l.quantity, l.vatRate as VatRate));
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]!;
    const m = money[i]!;
    await tx.query(
      `INSERT INTO invoice_items
         (invoice_id, line_no, product_id, description, quantity, unit_price_satang,
          vat_rate, line_net_satang, line_vat_satang, line_total_satang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        invoiceId, i + 1, l.productId, l.description ?? known.get(l.productId) ?? null,
        l.quantity, l.unitPriceSatang, l.vatRate, m.netSatang, m.vatSatang, m.totalSatang,
      ],
    );
  }

  const totals = sumInvoice(money);
  await tx.query(
    `UPDATE invoices SET subtotal_satang = $2, vat_satang = $3, total_satang = $4, updated_at = now()
     WHERE id = $1`,
    [invoiceId, totals.subtotalSatang, totals.vatSatang, totals.totalSatang],
  );
}

export async function createInvoice(db: Database, input: CreateInvoiceInput): Promise<Invoice> {
  await assertContactForDoc(db, input.contactId, input.docType);
  const companyProfileId = input.companyProfileId ?? (await getCompanyProfile(db)).id;
  await assertActiveCompanyProfile(db, companyProfileId);
  const id = randomUUID();
  return db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO invoices
         (id, doc_type, company_profile_id, contact_id, issue_date, reference_no, note,
          attention, salesperson, due_date, payment_method, bank_name, bank_branch,
          cheque_no, payment_date, payment_amount_satang, collector)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, input.docType, companyProfileId, input.contactId, input.issueDate, input.referenceNo ?? null, input.note ?? null,
        input.attention ?? null, input.salesperson ?? null, input.dueDate ?? null, input.paymentMethod ?? null,
        input.bankName ?? null, input.bankBranch ?? null, input.chequeNo ?? null, input.paymentDate ?? null,
        input.paymentAmountSatang ?? null, input.collector ?? null],
    );
    if (input.lines && input.lines.length > 0) await replaceLines(tx, id, input.lines);
    await writeAudit(tx, {
      action: 'CREATE', entity: 'invoice_draft', entityId: id,
      newValue: { docType: input.docType, companyProfileId, contactId: input.contactId, lines: input.lines?.length ?? 0 },
    });
    const row = await tx.query(`SELECT * FROM invoices WHERE id = $1`, [id]);
    return shapeInvoice(row.rows[0]!);
  });
}

export async function updateInvoice(
  db: Database,
  id: string,
  patch: UpdateInvoiceInput,
): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const cur = await tx.query<{ status: string; doc_type: DocType }>(
      `SELECT status, doc_type FROM invoices WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!cur.rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบใบกำกับ' });
    if (cur.rows[0].status !== 'DRAFT') {
      throw new AppError('CONFLICT', { userMessage: 'แก้ไขได้เฉพาะฉบับร่าง (DRAFT)' });
    }
    if (patch.contactId) await assertContactForDoc(tx, patch.contactId, cur.rows[0].doc_type);
    if (patch.companyProfileId) await assertActiveCompanyProfile(tx, patch.companyProfileId);

    const sets: string[] = [];
    const params: unknown[] = [];
    const col: Record<string, string> = {
      companyProfileId: 'company_profile_id', contactId: 'contact_id', issueDate: 'issue_date', referenceNo: 'reference_no', note: 'note',
      attention: 'attention', salesperson: 'salesperson', dueDate: 'due_date', paymentMethod: 'payment_method',
      bankName: 'bank_name', bankBranch: 'bank_branch', chequeNo: 'cheque_no', paymentDate: 'payment_date',
      paymentAmountSatang: 'payment_amount_satang', collector: 'collector',
    };
    for (const [k, c] of Object.entries(col)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${c} = $${params.length}`);
    }
    if (sets.length > 0) {
      params.push(id);
      await tx.query(`UPDATE invoices SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
    }
    if (patch.lines) await replaceLines(tx, id, patch.lines);

    const row = await tx.query(`SELECT * FROM invoices WHERE id = $1`, [id]);
    return shapeInvoice(row.rows[0]!);
  });
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: InvoiceLine[];
  contact: Awaited<ReturnType<typeof getContact>>;
  company: Awaited<ReturnType<typeof getCompanyProfile>>;
  printSettings: Awaited<ReturnType<typeof getCompanyProfile>>['printSettings'];
}

export async function getInvoiceDetail(db: Database, id: string): Promise<InvoiceDetail> {
  const head = await db.query(`SELECT * FROM invoices WHERE id = $1`, [id]);
  if (!head.rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบใบกำกับ' });
  const invoice = shapeInvoice(head.rows[0]);

  const lineRows = await db.query<Record<string, unknown>>(
    `SELECT ii.*, p.sku AS product_sku, p.name AS product_name, p.unit_code AS product_unit
     FROM invoice_items ii JOIN products p ON p.id = ii.product_id
     WHERE ii.invoice_id = $1 ORDER BY ii.line_no`,
    [id],
  );
  const lines = camelizeRows<Record<string, unknown>>(lineRows.rows).map((c) => ({
    id: c.id as string,
    lineNo: num(c.lineNo),
    productId: c.productId as string,
    productSku: c.productSku as string,
    productName: c.productName as string,
    productUnit: c.productUnit as string,
    description: (c.description as string | null) ?? null,
    quantity: new Decimal(String(c.quantity ?? '0')).toString(),
    unitPriceSatang: num(c.unitPriceSatang),
    vatRate: num(c.vatRate),
    lineNetSatang: num(c.lineNetSatang),
    lineVatSatang: num(c.lineVatSatang),
    lineTotalSatang: num(c.lineTotalSatang),
  }));

  const liveCompany = await getCompanyProfile(db, invoice.companyProfileId);
  const company = invoice.status === 'DRAFT' ? liveCompany : {
    ...liveCompany,
    name: invoice.companyNameSnapshot ?? liveCompany.name,
    nameEn: invoice.companyNameEnSnapshot ?? liveCompany.nameEn,
    taxId: invoice.companyTaxIdSnapshot ?? liveCompany.taxId,
    branch: invoice.companyBranchSnapshot ?? liveCompany.branch,
    address: invoice.companyAddressSnapshot ?? liveCompany.address,
    phone: invoice.companyPhoneSnapshot ?? liveCompany.phone,
  };
  return {
    invoice,
    lines,
    contact: await getContact(db, invoice.contactId),
    company,
    printSettings: liveCompany.printSettings,
  };
}

export interface InvoicePage {
  rows: (Invoice & { contactName: string; companyName: string })[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listInvoices(db: Queryable, q: ListInvoicesQuery): Promise<InvoicePage> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown): void => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };
  if (q.docType) add('i.doc_type = ?', q.docType);
  if (q.companyProfileId) add('i.company_profile_id = ?', q.companyProfileId);
  if (q.status) add('i.status = ?', q.status);
  if (q.contactId) add('i.contact_id = ?', q.contactId);
  if (q.from) add('i.issue_date >= ?', q.from);
  if (q.to) add('i.issue_date <= ?', q.to);
  if (q.q) {
    params.push(`%${q.q.toLowerCase()}%`);
    where.push(`(lower(coalesce(i.invoice_number,'')) LIKE $${params.length} OR lower(c.name) LIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM invoices i JOIN contacts c ON c.id = i.contact_id ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.n ?? 0);
  const offset = (q.page - 1) * q.pageSize;
  const listRes = await db.query<Record<string, unknown>>(
    `SELECT i.*, c.name AS contact_name, cp.name AS company_name
     FROM invoices i JOIN contacts c ON c.id = i.contact_id JOIN company_profiles cp ON cp.id = i.company_profile_id
     ${whereSql}
     ORDER BY i.issue_date DESC, i.created_at DESC
     LIMIT ${q.pageSize} OFFSET ${offset}`,
    params,
  );
  return {
    rows: listRes.rows.map((r) => ({
      ...shapeInvoice(r),
      contactName: String((camelize<Record<string, unknown>>(r).contactName) ?? ''),
      companyName: String((camelize<Record<string, unknown>>(r).companyName) ?? ''),
    })),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

async function nextInvoiceNumber(tx: Queryable, companyProfileId: string, docType: DocType, isoDate: string): Promise<string> {
  const year = Number(isoDate.slice(0, 4));
  const res = await tx.query<{ assigned: string }>(
    `INSERT INTO doc_counters (company_profile_id, doc_type, year, next_seq) VALUES ($1, $2, $3, 2)
     ON CONFLICT (company_profile_id, doc_type, year) DO UPDATE SET next_seq = doc_counters.next_seq + 1
     RETURNING (doc_counters.next_seq - 1)::text AS assigned`,
    [companyProfileId, docType, year],
  );
  const seq = Number(res.rows[0]!.assigned);
  return `${docType}-${year}-${String(seq).padStart(4, '0')}`;
}

/** DRAFT -> CONFIRMED: assign a gapless number, post one movement per line, freeze totals. */
export function confirmInvoice(
  db: Database,
  id: string,
  idempotencyKey: string,
): Promise<IdempotentResult<unknown>> {
  return runIdempotent(db, { key: idempotencyKey, endpoint: `POST /invoices/${id}/confirm`, body: { id } }, async (tx) => {
    const head = await tx.query<Record<string, unknown>>(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
    if (!head.rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบใบกำกับ' });
    const inv = shapeInvoice(head.rows[0]);
    if (inv.status !== 'DRAFT') throw new AppError('CONFLICT', { userMessage: `ใบกำกับสถานะ ${inv.status} ยืนยันไม่ได้` });

    const lineRes = await tx.query<{
      line_no: number; product_id: string; quantity: string; unit_price_satang: string; vat_rate: number;
    }>(`SELECT line_no, product_id, quantity, unit_price_satang, vat_rate FROM invoice_items WHERE invoice_id = $1 ORDER BY line_no`, [id]);
    if (lineRes.rows.length === 0) throw new AppError('VALIDATION_FAILED', { userMessage: 'ใบกำกับไม่มีรายการสินค้า' });

    await assertPeriodOpen(tx, inv.issueDate);
    const contact = await assertContactForDoc(tx, inv.contactId, inv.docType);
    const mode = await getNegativeStockMode(tx);

    // recompute money from stored line values (never trust a stale header)
    const money = lineRes.rows.map((r) =>
      computeLine(asSatang(Number(r.unit_price_satang)), r.quantity, r.vat_rate as VatRate),
    );
    const totals = sumInvoice(money);

    const movementType = inv.docType === 'BUY' ? 'PURCHASE' : 'SALE';
    let cogs = asSatang(0);
    for (let i = 0; i < lineRes.rows.length; i += 1) {
      const r = lineRes.rows[i]!;
      const mv = await postMovementTx(tx, {
        productId: r.product_id,
        type: movementType,
        occurredOn: inv.issueDate,
        quantityMagnitude: new Decimal(r.quantity).toString(),
        unitCostSatang: inv.docType === 'BUY' ? Number(r.unit_price_satang) : undefined,
        sourceKind: 'INVOICE',
        sourceId: id,
        negativeStockMode: mode,
      });
      if (inv.docType === 'SELL') cogs = addSatang(cogs, asSatang(mv.cogsSatang));
    }

    const company = await assertActiveCompanyProfile(tx, inv.companyProfileId);
    const number = await nextInvoiceNumber(tx, inv.companyProfileId, inv.docType, inv.issueDate);

    await tx.query(
      `UPDATE invoices SET
         status = 'CONFIRMED', invoice_number = $2, confirmed_at = now(),
         subtotal_satang = $3, vat_satang = $4, total_satang = $5,
         total_cogs_satang = $6,
         contact_name_snapshot = $7, contact_tax_id_snapshot = $8,
         contact_branch_snapshot = $9, contact_address_snapshot = $10,
         company_name_snapshot = $11, company_name_en_snapshot = $12,
         company_tax_id_snapshot = $13, company_branch_snapshot = $14,
         company_address_snapshot = $15, company_phone_snapshot = $16,
         updated_at = now()
       WHERE id = $1`,
      [
        id, number, totals.subtotalSatang, totals.vatSatang, totals.totalSatang,
        inv.docType === 'SELL' ? cogs : null,
        contact.name, contact.taxId, contact.branch, contact.address,
        company.name, company.nameEn, company.taxId, company.branch, company.address, company.phone,
      ],
    );

    await writeAudit(tx, {
      action: 'CREATE', entity: 'invoice', entityId: id,
      newValue: { invoiceNumber: number, docType: inv.docType, totalSatang: totals.totalSatang },
    });

    return {
      statusCode: 200,
      body: {
        id, invoiceNumber: number, status: 'CONFIRMED',
        subtotalSatang: totals.subtotalSatang, vatSatang: totals.vatSatang, totalSatang: totals.totalSatang,
        totalCogsSatang: inv.docType === 'SELL' ? (cogs as number) : null,
      },
    };
  });
}

/** CONFIRMED -> VOID: reverse every ledger movement, keep the number (audit / gapless). */
export function voidInvoice(
  db: Database,
  id: string,
  idempotencyKey: string,
  reason: string,
): Promise<IdempotentResult<unknown>> {
  return runIdempotent(
    db,
    { key: idempotencyKey, endpoint: `POST /invoices/${id}/void`, body: { id, reason } },
    async (tx) => {
      const head = await tx.query<{ status: string; issue_date: string }>(
        `SELECT status, issue_date FROM invoices WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!head.rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบใบกำกับ' });
      if (head.rows[0].status === 'VOID') throw new AppError('ALREADY_VOIDED');
      if (head.rows[0].status !== 'CONFIRMED') {
        throw new AppError('CONFLICT', { userMessage: 'ยกเลิกได้เฉพาะใบที่ยืนยันแล้ว' });
      }
      await assertPeriodOpen(tx, head.rows[0].issue_date);

      const affected = await tx.query<{ product_id: string }>(
        `UPDATE movements SET status = 'VOIDED', voided_at = now(), void_reason = $2
         WHERE source_kind = 'INVOICE' AND source_id = $1 AND status = 'ACTIVE'
         RETURNING product_id`,
        [id, reason],
      );
      await tx.query(
        `UPDATE invoices SET status = 'VOID', voided_at = now(), void_reason = $2, updated_at = now() WHERE id = $1`,
        [id, reason],
      );
      for (const pid of new Set(affected.rows.map((r) => r.product_id))) {
        await recomputeStockState(tx, pid);
      }
      await writeAudit(tx, {
        action: 'VOID', entity: 'invoice', entityId: id,
        oldValue: { status: 'CONFIRMED' }, newValue: { status: 'VOID' }, reason,
      });
      return { statusCode: 200, body: { id, status: 'VOID', reversedProducts: new Set(affected.rows.map((r) => r.product_id)).size } };
    },
  );
}
