export type ExperimentVisualState =
  | 'IDLE'
  | 'PRELOADING'
  | 'STABLE_OPERATION'
  | 'FAILURE_TRIGGERED'
  | 'RECOVERING'
  | 'RECOVERED'
  | 'COMPLETED'
  | 'FAILED';

export type TelemetryStatus =
  | 'WAITING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECEIVING'
  | 'NO_DATA'
  | 'ACTIVE'
  | 'DISABLED'
  | 'UNAVAILABLE'
  | 'COMPLETED'
  | 'FAILED'
  | 'ERROR';

export interface TelemetryPoint {
  runId: string;
  timestampUs: number;
  relativeSeconds: number;
  value: number;
  type?: string;
  /** Latência: 'N' (normal) ou 'A' (anormal / fase de falha) */
  metricType?: string;
}

export interface TelemetryMessage {
  runId: string;
  timestampUs: number;
  value: number;
  type?: string;
  payload?: any;
}

export interface DashboardState {
  runId: string | null;
  experimentState: ExperimentVisualState;
  telemetryStatus: Record<string, TelemetryStatus>;
  runStartUs: number | null;
  events: Record<string, any>;
  durations: {
    preload: number | null;
    stable: number | null;
    recovery: number | null;
  };
  dataTransfer: TelemetryPoint[];
  dataCpu: TelemetryPoint[];
  dataMemory: TelemetryPoint[];
  dataLatency: TelemetryPoint[];
}
