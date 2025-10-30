export interface IMangoCallParticipant {
  number: string;
  type?: string;
}

export interface IMangoWebhookPayload {
  call_id: string;
  call_state: 'Appeared' | 'Connected' | 'Disconnected';
  from: IMangoCallParticipant;
  to: IMangoCallParticipant;
  timestamp?: number;
  create_time?: number;
  answer_time?: number;
  end_time?: number;
  disconnect_reason?: number;
  entry_id?: string;
  location?: string;
  command_id?: string;
  result?: string;
  duration?: number;
}

export interface IMangoRecordingWebhook {
  entry_id: string;
  recording_id: string;
  recording_state: 'Started' | 'Processing' | 'Completed' | 'Failed';
  recording_url?: string;
  call_id?: string;
}

export interface IMangoApiConfig {
  apiKey: string;
  apiSalt: string;
  apiUrl: string;
}

