/** Must match public.allowed_platforms(). */
export const PLATFORMS = [
  'Facebook',
  'Instagram',
  'TikTok',
  'LinkedIn',
  'YouTube',
  'X',
  'Threads',
  'Pinterest',
  'Google Business Profile',
  'Website',
  'Email',
  'Other',
] as const

export const PLATFORM_SHORT: Record<string, string> = {
  Facebook: 'FB',
  Instagram: 'IG',
  TikTok: 'TT',
  LinkedIn: 'LI',
  YouTube: 'YT',
  X: 'X',
  Threads: 'TH',
  Pinterest: 'PI',
  'Google Business Profile': 'GBP',
  Website: 'WEB',
  Email: 'EM',
  Other: '…',
}

/** Must match the storage bucket's allowed_mime_types and size limit. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const ALLOWED_UPLOAD_TYPES: Record<string, 'image' | 'video' | 'document' | 'design'> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'application/pdf': 'document',
  'application/zip': 'design',
  'text/plain': 'document',
  'text/csv': 'document',
  'application/msword': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'image/vnd.adobe.photoshop': 'design',
  'application/postscript': 'design',
}

export const STORAGE_BUCKET = 'workspace-files'

export const COMMON_TIMEZONES = [
  'Asia/Manila',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Dubai',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
]
