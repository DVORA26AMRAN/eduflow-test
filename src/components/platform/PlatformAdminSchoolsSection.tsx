import { useCallback, useEffect, useState } from 'react'
import type {
  InstitutionAdminRecord,
  InstitutionFormFields,
  InstitutionManagerInviteFields,
  InstitutionManagerRecord,
} from '../../types/institutionAdmin'
import {
  INSTITUTION_MANAGER_INVITE_ACTION_LABEL,
  INSTITUTION_MANAGER_INVITED_LABEL,
  INSTITUTION_MANAGER_JOINED_LABEL,
  INSTITUTION_MANAGER_NONE_DETAIL,
  INSTITUTION_MANAGER_NONE_LABEL,
} from '../../types/institutionAdmin'
import {
  createInstitutionAsPlatformAdmin,
  inviteInstitutionManagerAsPlatformAdmin,
  loadInstitutionForPlatformAdmin,
  loadInstitutionManagerForPlatformAdmin,
  loadInstitutionsForPlatformAdmin,
  updateInstitutionAsPlatformAdmin,
} from '../../services/institutionAdmin'
import {
  removeInstitutionLogo,
  uploadInstitutionLogo,
} from '../../services/institutionLogo'
import { projectInstitutionManagerPanelState } from '../../utils/institutionManagerInvite'
import { SchoolLogo } from '../SchoolLogo'
import { InstitutionForm } from './InstitutionForm'
import './PlatformAdminSchoolsSection.css'

const EMPTY_FORM: InstitutionFormFields = {
  name: '',
  institutionCode: '',
  address: '',
  city: '',
  phone: '',
  email: '',
}

const EMPTY_MANAGER_INVITE: InstitutionManagerInviteFields = {
  fullName: '',
  email: '',
}

type ViewMode = 'list' | 'create' | 'details'

function toFormFields(institution: InstitutionAdminRecord): InstitutionFormFields {
  return {
    name: institution.name,
    institutionCode: institution.institutionCode ?? '',
    address: institution.address ?? '',
    city: institution.city ?? '',
    phone: institution.phone ?? '',
    email: institution.email ?? '',
  }
}

export function PlatformAdminSchoolsSection() {
  const [institutions, setInstitutions] = useState<InstitutionAdminRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedInstitution, setSelectedInstitution] = useState<InstitutionAdminRecord | null>(
    null,
  )
  const [formValues, setFormValues] = useState<InstitutionFormFields>(EMPTY_FORM)
  const [formMessage, setFormMessage] = useState('')
  const [formMessageIsError, setFormMessageIsError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)
  const [isRemovingLogo, setIsRemovingLogo] = useState(false)
  const [logoMessage, setLogoMessage] = useState('')
  const [logoMessageIsError, setLogoMessageIsError] = useState(false)
  const [manager, setManager] = useState<InstitutionManagerRecord | null>(null)
  const [managerLoadError, setManagerLoadError] = useState('')
  const [managerInvite, setManagerInvite] = useState<InstitutionManagerInviteFields>(EMPTY_MANAGER_INVITE)
  const [showManagerInviteForm, setShowManagerInviteForm] = useState(false)
  const [isInvitingManager, setIsInvitingManager] = useState(false)
  const [managerMessage, setManagerMessage] = useState('')
  const [managerMessageIsError, setManagerMessageIsError] = useState(false)

  const refreshList = useCallback(async () => {
    setIsLoading(true)
    setLoadError('')
    const result = await loadInstitutionsForPlatformAdmin()
    if (!result.ok) {
      setInstitutions([])
      setLoadError(result.errorMessage)
      setIsLoading(false)
      return
    }
    setInstitutions(result.institutions)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void refreshList()
    })
  }, [refreshList])

  function handleFormChange(field: keyof InstitutionFormFields, value: string) {
    setFormValues((current) => ({ ...current, [field]: value }))
  }

  async function refreshManager(institutionId: string) {
    setManagerLoadError('')
    const result = await loadInstitutionManagerForPlatformAdmin(institutionId)
    if (!result.ok) {
      setManager(null)
      setManagerLoadError(result.errorMessage)
      return
    }
    setManager(result.manager)
  }

  function openCreate() {
    setViewMode('create')
    setSelectedId(null)
    setSelectedInstitution(null)
    setFormValues(EMPTY_FORM)
    setFormMessage('')
    setFormMessageIsError(false)
    setLogoMessage('')
    setManager(null)
    setManagerInvite(EMPTY_MANAGER_INVITE)
    setShowManagerInviteForm(false)
    setManagerMessage('')
  }

  async function openDetails(institutionId: string) {
    setViewMode('details')
    setSelectedId(institutionId)
    setFormMessage('')
    setLogoMessage('')
    setManagerMessage('')
    setManagerInvite(EMPTY_MANAGER_INVITE)
    setShowManagerInviteForm(false)
    setIsLoading(true)

    const result = await loadInstitutionForPlatformAdmin(institutionId)
    setIsLoading(false)

    if (!result.ok) {
      setSelectedInstitution(null)
      setManager(null)
      setLoadError(result.errorMessage)
      return
    }

    setSelectedInstitution(result.institution)
    setFormValues(toFormFields(result.institution))
    setLoadError('')
    await refreshManager(institutionId)
  }

  function backToList() {
    setViewMode('list')
    setSelectedId(null)
    setSelectedInstitution(null)
    setFormValues(EMPTY_FORM)
    setFormMessage('')
    setLogoMessage('')
    setManager(null)
    setManagerInvite(EMPTY_MANAGER_INVITE)
    setShowManagerInviteForm(false)
    setManagerMessage('')
  }

  async function handleCreate() {
    setIsSubmitting(true)
    setFormMessage('')
    const result = await createInstitutionAsPlatformAdmin(formValues)
    setIsSubmitting(false)

    if (!result.ok) {
      setFormMessage(result.errorMessage)
      setFormMessageIsError(true)
      return
    }

    setFormMessage('בית הספר נוצר בהצלחה.')
    setFormMessageIsError(false)
    await refreshList()
    await openDetails(result.institutionId)
  }

  async function handleUpdate() {
    if (!selectedId) {
      return
    }

    setIsSubmitting(true)
    setFormMessage('')
    const result = await updateInstitutionAsPlatformAdmin(selectedId, formValues)
    setIsSubmitting(false)

    if (!result.ok) {
      setFormMessage(result.errorMessage)
      setFormMessageIsError(true)
      return
    }

    setFormMessage('פרטי בית הספר עודכנו.')
    setFormMessageIsError(false)
    await refreshList()
    const refreshed = await loadInstitutionForPlatformAdmin(selectedId)
    if (refreshed.ok) {
      setSelectedInstitution(refreshed.institution)
      setFormValues(toFormFields(refreshed.institution))
    }
  }

  async function handleLogoUpload(file: File) {
    if (!selectedInstitution) {
      return
    }

    setIsUploadingLogo(true)
    setLogoMessage('')
    const result = await uploadInstitutionLogo({
      institutionId: selectedInstitution.id,
      file,
    })
    setIsUploadingLogo(false)

    if (!result.ok) {
      setLogoMessage(result.errorMessage)
      setLogoMessageIsError(true)
      return
    }

    setSelectedInstitution((current) =>
      current
        ? {
            ...current,
            logoUrl: result.logoUrl,
            logoUpdatedAt: new Date().toISOString(),
          }
        : current,
    )
    setInstitutions((current) =>
      current.map((institution) =>
        institution.id === selectedInstitution.id
          ? {
              ...institution,
              logoUrl: result.logoUrl,
              logoUpdatedAt: new Date().toISOString(),
            }
          : institution,
      ),
    )
    setLogoMessage('הלוגו הועלה בהצלחה.')
    setLogoMessageIsError(false)
  }

  async function handleLogoRemove() {
    if (!selectedInstitution) {
      return
    }

    setIsRemovingLogo(true)
    setLogoMessage('')
    const result = await removeInstitutionLogo(selectedInstitution.id)
    setIsRemovingLogo(false)

    if (!result.ok) {
      setLogoMessage(result.errorMessage)
      setLogoMessageIsError(true)
      return
    }

    setSelectedInstitution((current) =>
      current
        ? {
            ...current,
            logoUrl: null,
            logoUpdatedAt: new Date().toISOString(),
          }
        : current,
    )
    setInstitutions((current) =>
      current.map((institution) =>
        institution.id === selectedInstitution.id
          ? {
              ...institution,
              logoUrl: null,
              logoUpdatedAt: new Date().toISOString(),
            }
          : institution,
      ),
    )
    setLogoMessage('הלוגו הוסר בהצלחה.')
    setLogoMessageIsError(false)
  }

  async function handleInviteManager(fields: InstitutionManagerInviteFields = managerInvite) {
    if (!selectedInstitution) {
      return
    }

    setIsInvitingManager(true)
    setManagerMessage('')
    const result = await inviteInstitutionManagerAsPlatformAdmin(selectedInstitution.id, fields)
    setIsInvitingManager(false)

    if (!result.ok) {
      setManagerMessage(result.errorMessage)
      setManagerMessageIsError(true)
      return
    }

    setManagerInvite(EMPTY_MANAGER_INVITE)
    setShowManagerInviteForm(false)
    setManagerMessage(result.resent ? 'ההזמנה נשלחה מחדש.' : 'המנהלת הוזמנה בהצלחה.')
    setManagerMessageIsError(false)
    await refreshManager(selectedInstitution.id)
  }

  const managerPanel = projectInstitutionManagerPanelState(manager)

  return (
    <section className="ds-card platform-admin-schools" data-testid="platform-admin-schools">
      <div className="platform-admin-schools__header">
        <h2 className="platform-admin-schools__title">בתי ספר</h2>
        {viewMode === 'list' ? (
          <button type="button" className="ds-btn ds-btn--primary" onClick={openCreate}>
            הוספת בית ספר
          </button>
        ) : (
          <button type="button" className="ds-btn ds-btn--secondary" onClick={backToList}>
            חזרה לרשימה
          </button>
        )}
      </div>

      {isLoading ? <p className="ds-form-message">טוען בתי ספר...</p> : null}

      {!isLoading && loadError && viewMode === 'list' ? (
        <p className="ds-form-message ds-form-message--error">{loadError}</p>
      ) : null}

      {!isLoading && viewMode === 'list' && !loadError && institutions.length === 0 ? (
        <p className="ds-form-message">לא נמצאו בתי ספר.</p>
      ) : null}

      {!isLoading && viewMode === 'list' && institutions.length > 0 ? (
        <ul className="platform-admin-schools__list">
          {institutions.map((institution) => (
            <li key={institution.id}>
              <button
                type="button"
                className="platform-admin-schools__card"
                onClick={() => void openDetails(institution.id)}
              >
                <SchoolLogo schoolName={institution.name} logoUrl={institution.logoUrl} />
                <div className="platform-admin-schools__card-body">
                  <p className="platform-admin-schools__card-name">{institution.name}</p>
                  <p className="platform-admin-schools__card-meta">
                    סמל: {institution.institutionCode?.trim() || '—'}
                  </p>
                  <p className="platform-admin-schools__card-meta">
                    עיר: {institution.city?.trim() || '—'}
                  </p>
                  <p className="platform-admin-schools__card-meta">
                    טלפון: {institution.phone?.trim() || '—'}
                  </p>
                  <p className="platform-admin-schools__card-meta">
                    אימייל: {institution.email?.trim() || '—'}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {viewMode === 'create' ? (
        <InstitutionForm
          title="הוספת בית ספר"
          values={formValues}
          submitLabel="שמירת בית ספר"
          isSubmitting={isSubmitting}
          message={formMessage}
          messageIsError={formMessageIsError}
          onChange={handleFormChange}
          onSubmit={() => void handleCreate()}
          onCancel={backToList}
        />
      ) : null}

      {viewMode === 'details' && selectedInstitution ? (
        <div className="platform-admin-schools__details">
          <InstitutionForm
            title="פרטי בית ספר"
            values={formValues}
            submitLabel="שמירת שינויים"
            isSubmitting={isSubmitting}
            message={formMessage}
            messageIsError={formMessageIsError}
            onChange={handleFormChange}
            onSubmit={() => void handleUpdate()}
          />

          <div className="platform-admin-schools__logo-panel">
            <h3 className="platform-admin-schools__logo-title">לוגו בית הספר</h3>
            <SchoolLogo
              schoolName={selectedInstitution.name}
              logoUrl={selectedInstitution.logoUrl}
            />
            <div className="platform-admin-schools__logo-actions">
              <label className="ds-btn ds-btn--primary platform-admin-schools__upload">
                {isUploadingLogo ? 'מעלה...' : 'העלאת לוגו'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="platform-admin-schools__file-input"
                  disabled={isUploadingLogo || isRemovingLogo}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) {
                      void handleLogoUpload(file)
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="ds-btn ds-btn--secondary"
                disabled={isUploadingLogo || isRemovingLogo || !selectedInstitution.logoUrl}
                onClick={() => void handleLogoRemove()}
              >
                {isRemovingLogo ? 'מסיר...' : 'הסרת לוגו'}
              </button>
            </div>
            {logoMessage ? (
              <p
                className={
                  logoMessageIsError
                    ? 'ds-form-message ds-form-message--error'
                    : 'ds-form-message ds-form-message--success'
                }
              >
                {logoMessage}
              </p>
            ) : null}
            <p className="platform-admin-schools__id-note">
              מזהה מוסד (לא ניתן לשינוי): {selectedInstitution.id}
            </p>
          </div>

          <div className="platform-admin-schools__manager-panel" data-testid="institution-manager-panel">
            <h3 className="platform-admin-schools__manager-title">מנהלת בית הספר</h3>

            {managerLoadError ? (
              <p className="ds-form-message ds-form-message--error">{managerLoadError}</p>
            ) : null}

            {managerPanel.kind === 'none' ? (
              <>
                <p className="platform-admin-schools__manager-status">{INSTITUTION_MANAGER_NONE_LABEL}</p>
                <p className="platform-admin-schools__manager-detail">{INSTITUTION_MANAGER_NONE_DETAIL}</p>
                {!showManagerInviteForm ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn--primary"
                    onClick={() => {
                      setShowManagerInviteForm(true)
                      setManagerMessage('')
                    }}
                  >
                    {INSTITUTION_MANAGER_INVITE_ACTION_LABEL}
                  </button>
                ) : null}
              </>
            ) : null}

            {managerPanel.kind === 'invited' ? (
              <>
                <p className="platform-admin-schools__manager-status">
                  {INSTITUTION_MANAGER_INVITED_LABEL}
                </p>
                <p className="platform-admin-schools__manager-detail">
                  {managerPanel.manager.fullName}
                </p>
                <p className="platform-admin-schools__manager-detail">{managerPanel.manager.email}</p>
              </>
            ) : null}

            {managerPanel.kind === 'joined' ? (
              <>
                <p className="platform-admin-schools__manager-status">
                  {INSTITUTION_MANAGER_JOINED_LABEL}
                </p>
                <p className="platform-admin-schools__manager-detail">
                  {managerPanel.manager.fullName}
                </p>
                <p className="platform-admin-schools__manager-detail">{managerPanel.manager.email}</p>
              </>
            ) : null}

            {showManagerInviteForm && managerPanel.kind === 'none' ? (
              <div className="platform-admin-schools__manager-invite">
                <label className="ds-field">
                  <span className="ds-label">שם מלא</span>
                  <input
                    className="ds-input"
                    value={managerInvite.fullName}
                    onChange={(event) =>
                      setManagerInvite((current) => ({
                        ...current,
                        fullName: event.target.value,
                      }))
                    }
                    disabled={isInvitingManager}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-label">אימייל</span>
                  <input
                    className="ds-input"
                    type="email"
                    value={managerInvite.email}
                    onChange={(event) =>
                      setManagerInvite((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    disabled={isInvitingManager}
                  />
                </label>
                <div className="platform-admin-schools__manager-invite-actions">
                  <button
                    type="button"
                    className="ds-btn ds-btn--primary"
                    disabled={isInvitingManager}
                    onClick={() => void handleInviteManager()}
                  >
                    {isInvitingManager ? 'שולח...' : 'שליחת הזמנה'}
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary"
                    disabled={isInvitingManager}
                    onClick={() => {
                      setShowManagerInviteForm(false)
                      setManagerInvite(EMPTY_MANAGER_INVITE)
                      setManagerMessage('')
                    }}
                  >
                    ביטול
                  </button>
                </div>
              </div>
            ) : null}

            {managerMessage ? (
              <p
                className={
                  managerMessageIsError
                    ? 'ds-form-message ds-form-message--error'
                    : 'ds-form-message ds-form-message--success'
                }
              >
                {managerMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
