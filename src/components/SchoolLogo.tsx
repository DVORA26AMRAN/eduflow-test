import { useState } from 'react'
import { SCHOOL_LOGO_PLACEHOLDER_TEXT } from '../types/institutionLogo'
import './SchoolLogo.css'

type SchoolLogoProps = {
  schoolName: string
  logoUrl?: string | null
  size?: 'default' | 'compact' | 'header'
  placeholderVariant?: 'text' | 'icon'
}

export function SchoolLogo({
  schoolName,
  logoUrl,
  size = 'default',
  placeholderVariant = 'text',
}: SchoolLogoProps) {
  const [hasImageError, setHasImageError] = useState(false)
  const shouldShowImage = Boolean(logoUrl) && !hasImageError

  const sizeClass =
    size === 'header'
      ? 'school-logo--header'
      : size === 'compact'
        ? 'school-logo--compact'
        : ''

  return (
    <div className={['school-logo', sizeClass].filter(Boolean).join(' ')}>
      {shouldShowImage ? (
        <img
          className="school-logo__image"
          src={logoUrl ?? undefined}
          alt={`לוגו ${schoolName}`}
          onError={() => setHasImageError(true)}
        />
      ) : (
        <div
          className={[
            'school-logo__placeholder',
            placeholderVariant === 'icon' ? 'school-logo__placeholder--icon' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={`לוגו ${schoolName}`}
        >
          {placeholderVariant === 'icon' ? (
            <svg
              className="school-logo__icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M4 10.5 12 5l8 5.5V19a1 1 0 0 1-1 1h-5v-5.5h-4V20H5a1 1 0 0 1-1-1v-8.5Z"
                fill="currentColor"
              />
            </svg>
          ) : (
            SCHOOL_LOGO_PLACEHOLDER_TEXT
          )}
        </div>
      )}
    </div>
  )
}
