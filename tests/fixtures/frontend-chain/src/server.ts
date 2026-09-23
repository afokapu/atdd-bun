import { escapeHtml, fragment } from "./html";
import { Cart } from "./wagons/checkout/presentation/cart";

const port = Number(process.env.PORT ?? 4317);
const page = (title: string, body: string, status = 200) => new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <header class="bar"><p class="brand">Shop</p></header>
  <main class="page"><h1>${escapeHtml(title)}</h1>${fragment(body)}</main>
</body>
</html>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/app.css") return new Response(Bun.file(new URL("./app.css", import.meta.url)), { headers: { "content-type": "text/css" } });
    if (url.pathname === "/" && request.method === "GET") return page("Checkout", Cart(url.searchParams.has("empty") ? [] : ["Coffee beans", "Paper filters"]));
    if (url.pathname === "/orders" && request.method === "POST") {
      const items = Number((await request.formData()).get("items"));
      if (!items) return page("Checkout", `<p role="alert" class="error">Your cart is empty</p>`, 422);
      return page("Order placed", `<form method="post" action="/payments"><button type="submit" class="button">Pay</button></form>`);
    }
    if (url.pathname === "/payments" && request.method === "POST") return page("Payment received", `<p>Thank you, your order is paid.</p>`);
    return page("Not found", `<p>No such page.</p>`, 404);
  },
});
