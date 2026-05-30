import { cn } from '@/lib/utils'
import type { Platform } from '@/lib/db/types'

interface PlatformIconProps {
  platform: Platform
  className?: string
}

export function PlatformIcon({ platform, className }: PlatformIconProps) {
  switch (platform) {
    case 'linkedin':
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="LinkedIn"
          role="img"
        >
          <rect width="24" height="24" rx="4" fill="#0A66C2" />
          <path
            d="M7.75 10h-2.5v7.5h2.5V10zM6.5 9a1.25 1.25 0 110-2.5A1.25 1.25 0 016.5 9zm10 8.5h-2.5v-3.75c0-.97-.02-2.22-1.35-2.22s-1.56 1.05-1.56 2.14v3.83H8.59V10h2.4v1.02h.03c.45-.85 1.54-1.27 2.57-1.27 2.75 0 3.26 1.81 3.26 4.16l-.35 3.59z"
            fill="white"
          />
        </svg>
      )

    case 'twitter':
      return (
        <svg
          className={cn('rounded', className)}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="X (Twitter)"
          role="img"
        >
          <rect width="24" height="24" rx="4" fill="#000" />
          <path
            d="M17.75 5h2.21l-4.83 5.52 5.68 7.5H17.3l-3.15-4.16-3.61 4.16H8.33l5.17-5.9L7.75 5h4.6l2.85 3.77L17.75 5zm-.78 11.65h1.22L7.28 6.25H5.97l11 10.4z"
            fill="white"
          />
        </svg>
      )

    case 'instagram':
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Instagram"
          role="img"
        >
          <defs>
            <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
              <stop offset="0%" stopColor="#fdf497" />
              <stop offset="5%" stopColor="#fdf497" />
              <stop offset="45%" stopColor="#fd5949" />
              <stop offset="60%" stopColor="#d6249f" />
              <stop offset="90%" stopColor="#285AEB" />
            </radialGradient>
          </defs>
          <rect width="24" height="24" rx="5.5" fill="url(#ig-grad)" />
          <path
            d="M15 8.5a1 1 0 100 2 1 1 0 000-2zM12 9.25a2.75 2.75 0 100 5.5 2.75 2.75 0 000-5.5zm0 4.5a1.75 1.75 0 110-3.5 1.75 1.75 0 010 3.5z"
            fill="white"
          />
          <path
            d="M15 4.5H9A4.5 4.5 0 004.5 9v6A4.5 4.5 0 009 19.5h6a4.5 4.5 0 004.5-4.5V9A4.5 4.5 0 0015 4.5zm3 10.5a3 3 0 01-3 3H9a3 3 0 01-3-3V9a3 3 0 013-3h6a3 3 0 013 3v6z"
            fill="white"
          />
        </svg>
      )

    case 'facebook':
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Facebook"
          role="img"
        >
          <rect width="24" height="24" rx="4" fill="#1877F2" />
          <path
            d="M16 8h-2c-.55 0-1 .45-1 1v1.5h3l-.5 3H13V21h-2.5v-7.5H9V10.5h1.5V9A3 3 0 0113.5 6H16v2z"
            fill="white"
          />
        </svg>
      )

    case 'threads':
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Threads"
          role="img"
        >
          <rect width="24" height="24" rx="6" fill="#000" />
          <path
            d="M15.49 11.16c-.1-.05-.2-.1-.31-.14-.18-2.1-1.28-3.31-3.2-3.33h-.03c-1.16 0-2.13.5-2.73 1.4l.97.67c.44-.67.9-.87 1.74-.87h.02c.67 0 1.19.2 1.52.58.24.28.4.66.47 1.13-.59-.1-1.23-.13-1.91-.09-1.92.11-3.15 1.23-3.07 2.79.04.79.44 1.47 1.12 1.92.57.39 1.3.57 2.06.53 1-.06 1.79-.41 2.35-1.07.42-.5.69-1.15.81-1.97.46.28.8.64.97 1.07.32.77.34 2-.46 2.93-.85.85-1.88 1.22-3.43 1.23-1.72-.01-3.02-.54-3.87-1.55-.8-1-.84-2.45-.07-3.3a7.8 7.8 0 01.87-1.67l-1.08-.72a9.23 9.23 0 00-1 1.94c-.46 1.3-.46 3.05.96 4.77.98 1.25 2.44 1.9 4.36 1.91h.005c1.63-.01 2.79-.44 3.75-1.4 1.32-1.32 1.29-2.97.84-3.99-.32-.77-.93-1.41-1.8-1.83v-.03z"
            fill="white"
          />
          <path
            d="M12.3 13.75c-.84.05-1.72-.33-1.76-1.14-.03-.6.43-1.27 1.84-1.35.16-.01.32-.01.47-.01.5 0 .97.05 1.39.14-.16 1.97-1.09 2.32-1.94 2.36z"
            fill="white"
          />
        </svg>
      )
  }
}
