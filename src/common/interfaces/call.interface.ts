export interface ICall {
  id: number;
  rk: string;
  city: string;
  avitoName: string | null;
  phoneClient: string;
  phoneAts: string;
  dateCreate: Date;
  operatorId: number;
  status: CallStatus;
  callId: string | null;
  duration: number | null;
  recordUrl: string | null;
  recordingPath: string | null;
  recordingProcessedAt: Date | null;
  recordingEmailSent: boolean;
  mangoData: any | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CallStatus = 'answered' | 'missed' | 'busy' | 'no_answer';

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

