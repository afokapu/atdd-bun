export type InvoiceDTO = { id: string; total(): number };
export const toInvoiceDTO = (x: any) => x;
