export interface ICall {
  id: number;
  rk: string;
  city: string;
  callDirection: CallDirection;
  avitoName: string | null;
  phoneClient: string;
  phoneAts: string;
  masterId: number | null;
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
    city?: string;
    sipAddress?: string | null;
  };
}

export interface ICallWithRelations extends ICallWithOperator {
  phone: {
    id: number;
    number: string;
    rk: string;
    city: string;
    avitoName: string | null;
  } | null;
  avito: {
    id: number;
    name: string;
    connectionStatus: string | null;
    isOnline: boolean | null;
  } | null;
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
