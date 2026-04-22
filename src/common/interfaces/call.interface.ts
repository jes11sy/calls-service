export interface ICall {
  id: number;
  rkId: number;
  cityId: number;
  callDirection: CallDirection;
  phoneClient: string;
  phoneAts: string;
  masterId: number | null;
  directorId: number | null;
  operatorId: number;
  status: CallStatus;
  callId: string | null;
  duration: number | null;
  recordingPath: string | null;
  recordingProcessedAt: Date | null;
  mangoData: any | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CallStatus = 'answered' | 'missed' | 'busy' | 'no_answer';
export type CallDirection = 'inbound' | 'outbound' | 'callback';

export interface ICallWithOperator extends ICall {
  operator: {
    id: number;
    name: string;
    login: string;
    cityIds?: number[];
    sipAddress?: string | null;
  };
  master?: { id: number; name: string } | null;
  rk?: { id: number; name: string } | null;
  city?: { id: number; name: string } | null;
}

export interface ICallWithRelations extends ICallWithOperator {
  /** Обращения с `call_id` → этот звонок (в БД нет `calls.appeal_id`) */
  appeals?: { id: number; sourceType: string; orderId: number | null }[];
  orderId?: number | null;
  source?: string | null;
}

export interface ICallStats {
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  totalDuration: number;
  avgDuration: number;
}

export interface IPaginatedCalls {
  calls: ICallWithRelations[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
