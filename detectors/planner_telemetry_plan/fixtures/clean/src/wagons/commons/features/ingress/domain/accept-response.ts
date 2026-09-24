// Telemetry: telemetry:event:be:commons:response-invocation-accepted
// Telemetry: telemetry:metric:be:commons:response-invocation-accepted:duration
export type TelemetryPort = { emit(id: string, properties: Record<string, unknown>): void };

export function acceptResponse(response: { id: string }, telemetry: TelemetryPort): void {
  telemetry.emit("telemetry:event:be:commons:response-invocation-accepted", { response_id: response.id, outcome: "accepted" });
  telemetry.emit("telemetry:metric:be:commons:response-invocation-accepted:duration", { outcome: "accepted" });
}
