// The one place a telemetry vendor SDK may appear: the outer adapter.
import { metrics } from "@opentelemetry/api";

export const otelTelemetry = {
  emit(id: string, properties: Record<string, unknown>): void {
    metrics.getMeter("commons").createCounter(id.replace(/^telemetry:/, "")).add(1, properties as Record<string, string>);
  },
};
