export interface IRealtimeCallPayload {
  id: number;
  rkId?: number;
  rkName?: string | null;
  cityId?: number;
  cityName?: string | null;
  callDirection?: string;
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
