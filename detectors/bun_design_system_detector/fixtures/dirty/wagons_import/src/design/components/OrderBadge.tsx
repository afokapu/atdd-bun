import { orderStatus } from "../../wagons/orders/order-status";

export function OrderBadge() {
  return <span>{orderStatus[0]}</span>;
}
