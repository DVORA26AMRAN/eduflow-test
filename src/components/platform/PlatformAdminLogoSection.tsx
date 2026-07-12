import { useCallback, useEffect, useState } from 'react'
import type { InstitutionSummary } from '../../types/school'
import {
  loadAllInstitutions,
  removeInstitutionLogo,
  uploadInstitutionLogo,
} from '../../services/institutionLogo'
import { SchoolLogo } from '../SchoolLogo'
import './PlatformAdminLogoSection.css'

export function PlatformAdminLogoSection() {
  const [institutions, setInstitutions] = useState<InstitutionSummary[]>([])
  const [selectedInstitutionId, setSelectedInstitutionId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [statusMessageIsError, setStatusMessageIsError] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const fetchInstitutions = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')

    const result = await loadAllInstitutions()

    if (!result.ok) {
      setInstitutions([])
      setLoadError(result.errorMessage)
    } else {
      setInstitutions(result.institutions)
      setSelectedInstitutionId((currentId) => {
        if (currentId && result.institutions.some((institution) => institution.id === currentId)) {
          return currentId
        }

        return result.institutions[0]?.id ?? ''
      })
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchInstitutions()
    })
  }, [fetchInstitutions])

  const selectedInstitution =
    institutions.find((institution) => institution.id === selectedInstitutionId) ?? null

  async function handleUpload(file: File) {
    if (!selectedInstitution) {
      return
    }

    setStatusMessage('')
    setIsUploading(true)

    const result = await uploadInstitutionLogo({
      institutionId: selectedInstitution.id,
      file,
    })

    setIsUploading(false)

    if (!result.ok) {
      setStatusMessage(result.errorMessage)
      setStatusMessageIsError(true)
      return
    }

    setInstitutions((currentInstitutions) =>
      currentInstitutions.map((institution) =>
        institution.id === selectedInstitution.id
          ? {
              ...institution,
              logoUrl: result.logoUrl,
              logoUpdatedAt: new Date().toISOString(),
            }
          : institution,
      ),
    )
    setStatusMessage('הלוגו הועלה בהצלחה.')
    setStatusMessageIsError(false)
  }

  async function handleRemove() {
    if (!selectedInstitution) {
      return
    }

    setStatusMessage('')
    setIsRemoving(true)

    const result = await removeInstitutionLogo(selectedInstitution.id)

    setIsRemoving(false)

    if (!result.ok) {
      setStatusMessage(result.errorMessage)
      setStatusMessageIsError(true)
      return
    }

    setInstitutions((currentInstitutions) =>
      currentInstitutions.map((institution) =>
        institution.id === selectedInstitution.id
          ? {
              ...institution,
              logoUrl: null,
              logoUpdatedAt: new Date().toISOString(),
            }
          : institution,
      ),
    )
    setStatusMessage('הלוגו הוסר בהצלחה.')
    setStatusMessageIsError(false)
  }

  return (
    <section className="ds-card platform-admin-logo">
      <h2 className="platform-admin-logo__title">ניהול לוגואים לבתי ספר</h2>

      {isLoading && <p className="ds-form-message">טוען בתי ספר...</p>}

      {!isLoading && loadError && (
        <p className="ds-form-message ds-form-message--error">{loadError}</p>
      )}

      {!isLoading && !loadError && institutions.length === 0 && (
        <p className="ds-form-message">לא נמצאו בתי ספר.</p>
      )}

      {!isLoading && !loadError && institutions.length > 0 && (
        <>
          <label className="ds-field platform-admin-logo__field">
            <span className="ds-label">בית ספר</span>
            <select
              className="ds-input"
              value={selectedInstitutionId}
              onChange={(event) => setSelectedInstitutionId(event.target.value)}
            >
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </select>
          </label>

          {selectedInstitution && (
            <div className="platform-admin-logo__preview">
              <SchoolLogo
                schoolName={selectedInstitution.name}
                logoUrl={selectedInstitution.logoUrl}
              />
              <p className="platform-admin-logo__school-name">{selectedInstitution.name}</p>
            </div>
          )}

          <div className="platform-admin-logo__actions">
            <label className="ds-btn ds-btn--primary platform-admin-logo__upload-button">
              {isUploading ? 'מעלה...' : 'העלאת לוגו'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="platform-admin-logo__file-input"
                disabled={isUploading || isRemoving || !selectedInstitution}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) {
                    void handleUpload(file)
                  }
                }}
              />
            </label>

            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              disabled={isUploading || isRemoving || !selectedInstitution?.logoUrl}
              onClick={() => void handleRemove()}
            >
              {isRemoving ? 'מסיר...' : 'הסרת לוגו'}
            </button>
          </div>
        </>
      )}

      {statusMessage && (
        <p
          className={
            statusMessageIsError
              ? 'ds-form-message ds-form-message--error'
              : 'ds-form-message ds-form-message--success'
          }
        >
          {statusMessage}
        </p>
      )}
    </section>
  )
}
