export const orderRow = (order) => `<li class="order">${order.title}</li>`;

export const orderList = (orders) => `<ul id="orders">${orders.map(orderRow).join("")}</ul>`;
