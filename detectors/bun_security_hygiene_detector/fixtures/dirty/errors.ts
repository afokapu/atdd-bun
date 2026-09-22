export function notFound() {
  return new Response("order not found", { status: 404 });
}
export function payload() {
  return Response.json({ "error_code": "orderNotFound" }, { status: 404 });
}
