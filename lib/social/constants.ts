export const TOKEN_REFRESH_SKEW_SECONDS = 300

export const LINKEDIN_REQUIRED_SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social',
] as const

export const TWITTER_REQUIRED_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'offline.access',
] as const

export const INSTAGRAM_REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
] as const

export const FACEBOOK_REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
] as const

export const THREADS_REQUIRED_SCOPES = [
  'threads_basic',
  'threads_content_publish',
] as const
