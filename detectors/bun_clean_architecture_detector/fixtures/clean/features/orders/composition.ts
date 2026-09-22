// The composition root: the one place wiring happens.
import { handler } from "./presentation/api";
class OrderRepository { save(_n: number) {} }
export const wire = () => handler(new OrderRepository());
