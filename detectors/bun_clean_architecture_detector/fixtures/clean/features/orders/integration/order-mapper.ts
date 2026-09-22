// Mapping across the boundary belongs to integration.
import type { OrderDTO } from "../../../contracts/order";
export const toOrderDTO = (o: { id: string; total: number }): OrderDTO => ({ id: o.id, total: o.total });
