import { useState } from 'react'
import { SCHOOL_LOGO_PLACEHOLDER_TEXT } from '../types/institutionLogo'
import './SchoolLogo.css'

type SchoolLogoProps = {
  schoolName: string
  logoUrl?: string | null
  size?: 'default' | 'compact'
}

export function SchoolLogo({
  schoolName,
  logoUrl,
  size = 'default',
}: SchoolLogoProps) {
  const [hasImageError, setHasImageError] = useState(false)
  const shouldShowImage = Boolean(logoUrl) && !hasImageError

  return (
    <div
      className={['school-logo', size === 'compact' ? 'school-logo--compact' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {shouldShowImage ? (
        <img
          className="school-logo__image"
          src={logoUrl ?? undefined}
          alt={`לוגו ${schoolName}`}
          onError={() => setHasImageError(true)}
        />
      ) : (
        <div className="school-logo__placeholder" aria-label={`לוגו ${schoolName}`}>
          {SCHOOL_LOGO_PLACEHOLDER_TEXT}
        </div>
      )}
    </div>
  )
}
