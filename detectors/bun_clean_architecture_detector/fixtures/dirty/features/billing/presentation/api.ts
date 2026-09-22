class InvoiceRepository { save() {} }
export const handler = () => { const repo = new InvoiceRepository(); return fetch('/x'); };
