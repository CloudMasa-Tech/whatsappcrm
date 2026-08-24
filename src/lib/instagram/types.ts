// ============================================================
// Instagram integration type definitions.
// ============================================================

export type InstagramConnectionMethod = 'direct' | 'cloud_api';
export type InstagramConnectionStatus =
  | 'connected'
  | 'disconnected'
  | '2fa_pending'
  | 'error';

export interface InstagramConfigRow {
  id: string;
  account_id: string;
  project_id: string;
  user_id: string;
  connection_method: InstagramConnectionMethod;
  username: string | null;
  session_data: string | null;
  two_factor_identifier: string | null;
  instagram_business_id: string | null;
  page_id: string | null;
  access_token: string | null;
  verify_token: string | null;
  app_secret: string | null;
  name: string | null;
  profile_picture_url: string | null;
  status: InstagramConnectionStatus;
  last_error: string | null;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstagramDirectLoginResult {
  status: 'connected' | '2fa_required' | 'error';
  twoFactorIdentifier?: string;
  twoFactorType?: 'sms' | 'totp' | 'email';
  obfuscatedPhone?: string;
  username?: string;
  name?: string;
  profilePictureUrl?: string;
  error?: string;
}

export interface InstagramSendMessageResult {
  messageId: string;
  externalMessageId?: string;
  success: boolean;
}

export interface InstagramWebhookEvent {
  object: 'instagram' | 'page';
  entry?: Array<{
    id: string;
    time: number;
    messaging?: Array<{
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: {
        mid: string;
        text?: string;
        attachments?: Array<{
          type: 'image' | 'video' | 'audio' | 'file' | 'share';
          payload: { url: string; title?: string };
        }>;
        reply_to?: { mid: string };
      };
      delivery?: { mids: string[]; watermark: number };
      read?: { watermark: number };
    }>;
  }>;
}
