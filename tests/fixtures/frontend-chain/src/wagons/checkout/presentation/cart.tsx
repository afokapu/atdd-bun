/** The cart the buyer checks out: a server-rendered htmx fragment. */
export function Cart(items: string[]): string {
  const rows = items.map((item) => `<li>${item}</li>`).join("");
  return `<section class="card" aria-labelledby="cart-title">
  <h2 id="cart-title">Your cart</h2>
  ${items.length ? `<ul class="items">${rows}</ul>` : `<p>Your cart has no items.</p>`}
  <form method="post" action="/orders" hx-post="/orders" hx-target="main">
    <input type="hidden" name="items" value="${items.length}">
    <button type="submit" class="button">Place order</button>
  </form>
</section>`;
}
