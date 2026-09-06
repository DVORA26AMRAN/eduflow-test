import { useId, useMemo, useState } from 'react'
import { updateInstitutionPrintingSettings } from '../../../services/printingRequests'
import { mapPrintingErrorCode } from '../../../utils/printingUi'
import {
  PRINTING_DAILY_CUTOFF_EXPLANATION,
  PRINTING_RELATIVE_NOTICE_PRESETS,
  PRINTING_SUBMISSION_POLICY_PRESET_LABELS,
  PRINTING_SUBMISSION_POLICY_QUESTION,
  buildPrintingSubmissionPolicySavePayload,
  printingSubmissionPolicyChoicesEqual,
  reconstructPrintingSubmissionPolicyChoice,
  type PrintingSubmissionPolicySavedState,
  type PrintingSubmissionPolicyUiChoice,
} from '../../../utils/printingSubmissionPolicy'

type PrintingSubmissionPolicySettingsProps = {
  saved: PrintingSubmissionPolicySavedState
  onSaved: (next: PrintingSubmissionPolicySavedState) => void
}

type Feedback = { kind: 'success' | 'error'; message: string } | null

export function PrintingSubmissionPolicySettings({
  saved,
  onSaved,
}: PrintingSubmissionPolicySettingsProps) {
  const baseId = useId()
  const questionId = `${baseId}-question`
  const customHoursId = `${baseId}-custom-hours`
  const customMinutesId = `${baseId}-custom-minutes`
  const cutoffId = `${baseId}-cutoff`

  const initialChoice = useMemo(
    () => reconstructPrintingSubmissionPolicyChoice(saved),
    [saved],
  )

  const [choice, setChoice] = useState<PrintingSubmissionPolicyUiChoice>(initialChoice)
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const isDirty = !printingSubmissionPolicyChoicesEqual(choice, initialChoice)

  function selectPreset(minutes: (typeof PRINTING_RELATIVE_NOTICE_PRESETS)[number]) {
    setChoice({ kind: 'preset', minutes })
    setFeedback(null)
  }

  function selectCustom() {
    if (choice.kind === 'custom') return
    if (choice.kind === 'preset') {
      setChoice({
        kind: 'custom',
        hours: Math.floor(choice.minutes / 60),
        minutes: choice.minutes % 60,
      })
    } else {
      setChoice({
        kind: 'custom',
        hours: Math.floor(saved.noticeMinutes / 60),
        minutes: saved.noticeMinutes % 60,
      })
    }
    setFeedback(null)
  }

  function onSelectDaily() {
    const restored = reconstructPrintingSubmissionPolicyChoice({
      mode: 'daily_cutoff',
      noticeMinutes: saved.noticeMinutes,
      cutoffLocalTime: saved.cutoffLocalTime ?? '08:00:00',
    })
    setChoice(
      restored.kind === 'daily_cutoff' ? restored : { kind: 'daily_cutoff', localTime: '08:00' },
    )
    setFeedback(null)
  }

  async function handleSave() {
    if (isSaving || !isDirty) return

    const payload = buildPrintingSubmissionPolicySavePayload({
      choice,
      preservedNoticeMinutes: saved.noticeMinutes,
    })
    if (!payload.ok) {
      setFeedback({ kind: 'error', message: payload.errorMessage })
      return
    }

    setIsSaving(true)
    setFeedback(null)
    const result = await updateInstitutionPrintingSettings({
      printSubmissionPolicyMode: payload.printSubmissionPolicyMode,
      minimumPrintNoticeMinutes: payload.minimumPrintNoticeMinutes,
      printDailyCutoffLocalTime: payload.printDailyCutoffLocalTime,
    })
    setIsSaving(false)

    if (!result.ok) {
      setFeedback({
        kind: 'error',
        message: mapPrintingErrorCode(result.error_code),
      })
      return
    }

    onSaved({
      mode: payload.printSubmissionPolicyMode,
      noticeMinutes: payload.minimumPrintNoticeMinutes,
      cutoffLocalTime: payload.printDailyCutoffLocalTime,
      timeZone: saved.timeZone,
    })
    setFeedback({ kind: 'success', message: 'מדיניות השליחה להדפסה נשמרה.' })
  }

  const selectedKind =
    choice.kind === 'preset'
      ? String(choice.minutes)
      : choice.kind === 'custom'
        ? 'custom'
        : 'daily'

  return (
    <section
      className="secretary-printing__policy"
      aria-labelledby={questionId}
      data-testid="printing-submission-policy-settings"
    >
      <h3 id={questionId} className="secretary-printing__policy-title">
        {PRINTING_SUBMISSION_POLICY_QUESTION}
      </h3>
      <p className="ds-helper-text secretary-printing__policy-hint">
        ההגדרה חלה על שליחת בקשות הדפסה על ידי מורות במוסד זה.
      </p>

      <fieldset className="secretary-printing__policy-fieldset" disabled={isSaving}>
        <legend className="visually-hidden">{PRINTING_SUBMISSION_POLICY_QUESTION}</legend>
        <div
          className="secretary-printing__policy-options"
          role="radiogroup"
          aria-labelledby={questionId}
        >
          {PRINTING_RELATIVE_NOTICE_PRESETS.map((minutes) => {
            const optionId = `${baseId}-preset-${minutes}`
            return (
              <label key={minutes} className="secretary-printing__policy-option" htmlFor={optionId}>
                <input
                  id={optionId}
                  type="radio"
                  name={`${baseId}-policy`}
                  value={minutes}
                  checked={selectedKind === String(minutes)}
                  onChange={() => selectPreset(minutes)}
                />
                <span>{PRINTING_SUBMISSION_POLICY_PRESET_LABELS[minutes]}</span>
              </label>
            )
          })}

          <label className="secretary-printing__policy-option" htmlFor={`${baseId}-custom`}>
            <input
              id={`${baseId}-custom`}
              type="radio"
              name={`${baseId}-policy`}
              value="custom"
              checked={selectedKind === 'custom'}
              onChange={selectCustom}
            />
            <span>זמן אחר</span>
          </label>

          <label className="secretary-printing__policy-option" htmlFor={`${baseId}-daily`}>
            <input
              id={`${baseId}-daily`}
              type="radio"
              name={`${baseId}-policy`}
              value="daily"
              checked={selectedKind === 'daily'}
              onChange={onSelectDaily}
            />
            <span>עד שעה קבועה באותו יום</span>
          </label>
        </div>

        {choice.kind === 'custom' ? (
          <div className="secretary-printing__policy-custom">
            <label className="ds-field" htmlFor={customHoursId}>
              <span className="ds-field__label">שעות</span>
              <input
                id={customHoursId}
                className="ds-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={168}
                step={1}
                value={choice.hours}
                onChange={(e) => {
                  const hours = Number(e.target.value)
                  setChoice({
                    kind: 'custom',
                    hours: Number.isFinite(hours) ? hours : 0,
                    minutes: choice.minutes,
                  })
                  setFeedback(null)
                }}
              />
            </label>
            <label className="ds-field" htmlFor={customMinutesId}>
              <span className="ds-field__label">דקות</span>
              <input
                id={customMinutesId}
                className="ds-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                step={1}
                value={choice.minutes}
                onChange={(e) => {
                  const minutes = Number(e.target.value)
                  setChoice({
                    kind: 'custom',
                    hours: choice.hours,
                    minutes: Number.isFinite(minutes) ? minutes : 0,
                  })
                  setFeedback(null)
                }}
              />
            </label>
          </div>
        ) : null}

        {choice.kind === 'daily_cutoff' ? (
          <div className="secretary-printing__policy-daily">
            <label className="ds-field" htmlFor={cutoffId}>
              <span className="ds-field__label">שעת חתך לפי שעון המוסד</span>
              <input
                id={cutoffId}
                className="ds-input"
                type="time"
                value={choice.localTime}
                onChange={(e) => {
                  setChoice({ kind: 'daily_cutoff', localTime: e.target.value })
                  setFeedback(null)
                }}
              />
            </label>
            <p className="ds-helper-text" role="note">
              {PRINTING_DAILY_CUTOFF_EXPLANATION}
            </p>
            <p className="ds-helper-text">השעה נמדדת לפי שעון המוסד המוגדר במערכת.</p>
          </div>
        ) : null}
      </fieldset>

      <div className="secretary-printing__policy-actions">
        <button
          type="button"
          className="ds-btn ds-btn--primary"
          onClick={() => void handleSave()}
          disabled={!isDirty || isSaving}
          aria-busy={isSaving}
        >
          {isSaving ? 'שומר…' : 'שמירת מדיניות שליחה'}
        </button>
        {!isDirty && !feedback ? (
          <span className="ds-helper-text" role="status">
            אין שינויים לשמירה
          </span>
        ) : null}
      </div>

      {feedback ? (
        <p
          className={`ds-form-message ${feedback.kind === 'error' ? 'ds-form-message--error' : ''}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  )
}
