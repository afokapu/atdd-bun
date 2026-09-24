// Telemetry: telemetry:event:be:commons:unknown-item
// Telemetry: order-created
export function acceptResponse(
  response: { id: string; raw: string },
  telemetry: { emit(id: string, properties: Record<string, unknown>): void },
): void {
  telemetry.emit("order_accepted", { orderId: 7 });
  telemetry.emit("telemetry:event:be:commons:response-invocation-accepted", {
    response_id: response.id,
    raw_payload: response.raw,
    secret: "k",
  });
}
