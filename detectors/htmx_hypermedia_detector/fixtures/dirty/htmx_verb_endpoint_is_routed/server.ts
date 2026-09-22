// Station Master — JOURNEY_MAP is the declared journey space.
export const JOURNEY_MAP: Record<string, string> = {
  confirm_order: "3007-confirm-order-standard",
};

export function handle(req: Request): Response {
  const path = new URL(req.url).pathname;
  if (req.method === "POST" && path === "/orders/confirm") return new Response("ok");
  return new Response("ok");
}
