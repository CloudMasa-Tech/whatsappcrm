export type LinkedInAccountType = 'person' | 'organization';
export type LinkedInConnectionMethod = 'token' | 'oauth';

export interface LinkedInOrganizationSummary {
  id: string;
  urn: string;
  name: string;
  vanityName?: string | null;
  logoUrl?: string | null;
  role?: string | null;
}

export interface LinkedInProfileMeta {
  accountType: LinkedInAccountType;
  memberUrn: string | null;
  organizationId: string | null;
  organizationUrn: string | null;
  displayName: string;
  email?: string | null;
  headline?: string | null;
  vanityName?: string | null;
  profilePictureUrl: string | null;
  organizations: LinkedInOrganizationSummary[];
  grantedScopes: string[];
}

export interface LinkedInPostItem {
  urn: string;
  authorUrn: string;
  text: string;
  visibility: string;
  lifecycleState: string;
  createdAt: string | null;
  articleUrl?: string | null;
  articleTitle?: string | null;
  mediaUrn?: string | null;
}

export interface LinkedInCommentItem {
  id: string;
  urn: string;
  actorUrn: string;
  actorName?: string | null;
  text: string;
  createdAt: string | null;
}

export interface LinkedInAnalyticsSummary {
  organizationUrn: string;
  followerCount: number | null;
  impressionCount: number | null;
  uniqueImpressionsCount: number | null;
  clickCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  engagementRate: number | null;
}

export interface LinkedInLeadSubmission {
  externalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  formName: string | null;
  linkedinUrn: string | null;
  submittedAt: string | null;
}

export interface LinkedInConfigSafeRow {
  id?: string;
  connection_method: LinkedInConnectionMethod;
  account_type: LinkedInAccountType;
  member_urn: string | null;
  organization_id: string | null;
  organization_urn: string | null;
  display_name: string | null;
  headline: string | null;
  vanity_name: string | null;
  profile_picture_url: string | null;
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

