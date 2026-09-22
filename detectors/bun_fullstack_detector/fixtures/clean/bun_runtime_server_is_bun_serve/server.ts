// Full-stack Bun: native server, no middleware stack, no node_modules at runtime.
Bun.serve({
  port: 3000,
  routes: {
    "/orders": (req) => new Response(renderOrders(), { headers: { "content-type": "text/html" } }),
  },
});
