export interface IRealtimeCallPayload {
  id: number;
  rk?: string;
  city?: string;
  avitoName?: string | null;
  callId?: string | null;
  phoneClient: string;
  phoneAts?: string;
  dateCreate?: Date;
  status: string;
  duration?: number | null;
  recordUrl?: string | null;
  operatorId: number;
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

