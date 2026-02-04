export interface IRealtimeCallPayload {
  id: number;
  rk?: string;
  city?: string;
  callDirection?: string;
  avitoName?: string | null;
  callId?: string | null;
  phoneClient: string;
  phoneAts?: string;
  status: string;
  duration?: number | null;
  recordingPath?: string | null;
  operatorId: number;
  createdAt?: Date;
}

export interface IRealtimeBroadcast {
  token: string;
  call: IRealtimeCallPayload;
  rooms: string[];
}

export interface IRealtimeConfig {
  serviceUrl: string;
  webhookToken: string;
}
