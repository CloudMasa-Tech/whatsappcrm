export type XConnectionMethod = 'token' | 'oauth';

export interface XProfileMeta {
  xUserId: string;
  username: string;
  displayName: string;
  description: string | null;
  profileImageUrl: string | null;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  verified: boolean;
  grantedScopes: string[];
}

export interface XTweetItem {
  id: string;
  text: string;
  createdAt: string | null;
  permalink: string | null;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  impressionCount: number;
  authorUsername?: string | null;
  authorName?: string | null;
}

export interface XMentionItem {
  id: string;
  text: string;
  createdAt: string | null;
  authorId: string;
  authorName: string | null;
  authorUsername: string | null;
  authorProfileImageUrl: string | null;
  permalink: string | null;
  replyCount: number;
  likeCount: number;
}

export interface XDmMessageItem {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId?: string | null;
  text: string;
  createdAt: string | null;
  senderUsername?: string | null;
  senderName?: string | null;
}

export interface XConfigSafeRow {
  id?: string;
  connection_method: XConnectionMethod;
  x_user_id: string | null;
  username: string | null;
  display_name: string | null;
  description: string | null;
  profile_image_url: string | null;
  followers_count: number;
  following_count: number;
  tweet_count: number;
  verified: boolean;
  granted_scopes: string[];
  client_id: string | null;
  has_access_token: boolean;
  has_refresh_token: boolean;
  has_client_secret: boolean;
  token_expires_at: string | null;
  status: 'connected' | 'disconnected' | 'error';
  last_error: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
}

