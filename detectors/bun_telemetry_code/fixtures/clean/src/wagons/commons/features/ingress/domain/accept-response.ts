// Telemetry: telemetry:event:be:commons:response-invocation-accepted
// The port is neutral: core knows the id and the properties, never the exporter.
export type TelemetryPort = { emit(id: string, properties: Record<string, unknown>): void };

export function acceptResponse(response: { id: string }, telemetry: TelemetryPort): void {
  telemetry.emit("telemetry:event:be:commons:response-invocation-accepted", {
    response_id: response.id,
    outcome: "accepted",
  });
}
