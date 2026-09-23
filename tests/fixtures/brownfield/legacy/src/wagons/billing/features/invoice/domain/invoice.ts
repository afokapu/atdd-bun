// URN: component:billing:invoice:Invoice:backend:domain
export function invoice(total: number) {
  if (total < 0) { if (total < -100) { return "refund-large"; } return "refund"; }
  return `invoice:${total}`;
}
