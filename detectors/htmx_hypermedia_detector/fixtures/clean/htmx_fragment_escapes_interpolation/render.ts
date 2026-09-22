import { escapeHtml } from "./escape";

export const orderRow = (order) =>
  `<li class="order" id="order-${escapeHtml(order.id)}">${escapeHtml(order.title)}</li>`;

export const orderList = (orders) => `<ul id="orders">${orders.map(orderRow).join("")}</ul>`;
