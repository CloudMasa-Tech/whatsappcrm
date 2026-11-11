// ============================================================
// Instagram integration type definitions.
// ============================================================

export type InstagramConnectionMethod = 'direct' | 'cloud_api';
export type InstagramTokenType = 'facebook_page' | 'instagram_login';
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
  token_type?: InstagramTokenType | null;
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
  biography?: string | null;
  website?: string | null;
  followers_count?: number | null;
  following_count?: number | null;
  media_count?: number | null;
  is_verified?: boolean | null;
  granted_scopes?: string[] | null;
  last_synced_at?: string | null;
  comment_auto_reply_enabled?: boolean | null;
  comment_auto_reply_keyword?: string | null;
  comment_auto_reply_message?: string | null;
  comment_auto_dm_message?: string | null;
  status: InstagramConnectionStatus;
  last_error: string | null;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstagramProfileMeta {
  id: string;
  username: string;
  name: string;
  profilePictureUrl: string;
  biography?: string | null;
  website?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  mediaCount?: number | null;
  isVerified?: boolean;
  pageId?: string | null;
  pageAccessToken?: string | null;
  tokenType: InstagramTokenType;
  grantedScopes?: string[];
}

export interface InstagramDirectLoginResult {
  status: 'connected' | '2fa_required' | 'error';
  twoFactorIdentifier?: string;
  twoFactorType?: 'sms' | 'totp' | 'email';
  obfuscatedPhone?: string;
  username?: string;
  name?: string;
  profilePictureUrl?: string;
  sessionData?: string;
  error?: string;
}

export interface InstagramSendMessageResult {
  messageId: string;
  externalMessageId?: string;
  success: boolean;
}

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | string;
  media_product_type?: 'FEED' | 'REELS' | 'STORY' | 'AD' | string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  is_comment_enabled?: boolean;
  children?: Array<{
    id: string;
    media_type: string;
    media_url?: string;
    thumbnail_url?: string;
  }>;
}

export interface InstagramStoryItem {
  id: string;
  media_type: 'IMAGE' | 'VIDEO' | string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
  caption?: string;
}

export interface InstagramCommentItem {
  id: string;
  text: string;
  username?: string;
  from?: { id: string; username?: string };
  timestamp?: string;
  like_count?: number;
  hidden?: boolean;
  replies?: InstagramCommentItem[];
}

export interface InstagramInsightMetric {
  name: string;
  title?: string;
  description?: string;
  value: number;
  period?: string;
}

export interface InstagramWebhookMessagingItem {
  sender: { id: string };
  recipient: { id: string };
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: Array<{
      type: 'image' | 'video' | 'audio' | 'file' | 'share' | 'story_mention' | 'reel' | string;
      payload?: { url?: string; title?: string };
    }>;
    reply_to?: { mid?: string; story?: { url?: string; id?: string } };
  };
  reaction?: {
    mid: string;
    action: 'react' | 'unreact';
    reaction?: string;
    emoji?: string;
  };
  delivery?: { mids?: string[]; watermark?: number };
  read?: { watermark?: number };
}

export interface InstagramWebhookChangeItem {
  field: string;
  value?: {
    id?: string;
    comment_id?: string;
    text?: string;
    from?: { id?: string; username?: string };
    media?: { id?: string; media_product_type?: string };
    parent_id?: string;
  };
}

export interface InstagramWebhookEvent {
  object: 'instagram' | 'page';
  entry?: Array<{
    id: string;
    time?: number;
    messaging?: InstagramWebhookMessagingItem[];
    changes?: InstagramWebhookChangeItem[];
  }>;
}
