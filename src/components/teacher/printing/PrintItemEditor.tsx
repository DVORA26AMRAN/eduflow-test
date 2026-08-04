import type { PrintingDraftItem } from '../../../utils/printingUi'
import {
  PRINTING_PAPER_SIZE_OPTIONS,
  PRINTING_PAGES_PER_SHEET_OPTIONS,
  formatBytes,
  isPreviewablePrintFile,
  validateDraftItemSettings,
} from '../../../utils/printingUi'
import { MAX_PRINT_COPIES } from '../../../types/printing'

type PrintItemEditorProps = {
  item: PrintingDraftItem
  index: number
  total: number
  showCopyPrevious: boolean
  moreOpen: boolean
  onToggleMore: () => void
  onChange: (next: PrintingDraftItem) => void
  onCopyPrevious: () => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  disabled?: boolean
}

export function PrintItemEditor({
  item,
  index,
  total,
  showCopyPrevious,
  moreOpen,
  onToggleMore,
  onChange,
  onCopyPrevious,
  onRemove,
  onMoveUp,
  onMoveDown,
  disabled = false,
}: PrintItemEditorProps) {
  const settingsError = validateDraftItemSettings(item)
  const previewable = isPreviewablePrintFile(item.detected_file_type)

  function patch(partial: Partial<PrintingDraftItem>) {
    let next = { ...item, ...partial }
    if (partial.sides === 'single_sided') {
      next = { ...next, duplex_flip_mode: null }
    }
    if (partial.scale_mode && partial.scale_mode !== 'custom') {
      next = { ...next, custom_scale_percent: null }
    }
    if (partial.page_selection_mode === 'all') {
      next = { ...next, page_selection_value: null }
    }
    onChange(next)
  }

  return (
    <article className="printing-item" aria-label={`קובץ ${index + 1}: ${item.original_filename}`}>
      <header className="printing-item__header">
        <div className="printing-item__identity">
          <strong className="printing-item__filename">{item.original_filename}</strong>
          <span className="printing-item__meta">
            {item.detected_file_type} · {formatBytes(item.file_size_bytes)}
          </span>
          {item.uploadState === 'uploading' ? (
            <span className="printing-item__upload printing-item__upload--busy">מעלה…</span>
          ) : null}
          {item.uploadState === 'failed' ? (
            <span className="printing-item__upload printing-item__upload--error" role="alert">
              {item.uploadError ?? 'העלאה נכשלה'}
            </span>
          ) : null}
          {item.uploadState === 'uploaded' ? (
            <span className="printing-item__upload printing-item__upload--ok">הועלה</span>
          ) : null}
        </div>
        <div className="printing-item__reorder">
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={onMoveUp}
            disabled={disabled || index === 0}
            aria-label="העבר למעלה"
          >
            ▲
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={onMoveDown}
            disabled={disabled || index >= total - 1}
            aria-label="העבר למטה"
          >
            ▼
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={onRemove}
            disabled={disabled}
          >
            הסר
          </button>
        </div>
      </header>

      <div className="printing-item__preview-row">
        {previewable && item.previewUrl ? (
          item.detected_file_type === 'application/pdf' ? (
            <iframe
              title={`תצוגה מקדימה ${item.original_filename}`}
              className="printing-item__preview printing-item__preview--pdf"
              src={item.previewUrl}
            />
          ) : (
            <img
              className="printing-item__preview"
              src={item.previewUrl}
              alt={`תצוגה מקדימה של ${item.original_filename}`}
            />
          )
        ) : (
          <div className="printing-item__preview printing-item__preview--fallback" aria-hidden="true">
            <span>{item.original_filename.split('.').pop()?.toUpperCase()}</span>
          </div>
        )}
      </div>

      {showCopyPrevious ? (
        <div className="printing-item__copy-row">
          <button
            type="button"
            className="ds-btn ds-btn--secondary"
            onClick={onCopyPrevious}
            disabled={disabled}
          >
            העתק הגדרות מהקובץ הקודם
          </button>
        </div>
      ) : null}

      <div className="printing-item__settings">
        <fieldset className="printing-item__fieldset" disabled={disabled}>
          <legend className="ds-label">עמודים</legend>
          <div className="printing-item__choice-row" role="radiogroup" aria-label="בחירת עמודים">
            <label className="printing-item__choice">
              <input
                type="radio"
                name={`pages-${item.localId}`}
                checked={item.page_selection_mode === 'all'}
                onChange={() => patch({ page_selection_mode: 'all' })}
              />
              כל העמודים
            </label>
            <label className="printing-item__choice">
              <input
                type="radio"
                name={`pages-${item.localId}`}
                checked={item.page_selection_mode === 'custom'}
                onChange={() => patch({ page_selection_mode: 'custom' })}
              />
              מותאם
            </label>
          </div>
          {item.page_selection_mode === 'custom' ? (
            <input
              className="ds-input"
              aria-label="עמודים מותאמים"
              placeholder="לדוגמה: 1-3 או 1,3,5"
              value={item.page_selection_value ?? ''}
              onChange={(e) => patch({ page_selection_value: e.target.value })}
            />
          ) : null}
        </fieldset>

        <div className="printing-item__field">
          <span className="ds-label" id={`copies-label-${item.localId}`}>
            עותקים
          </span>
          <div className="printing-item__copies" role="group" aria-labelledby={`copies-label-${item.localId}`}>
            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              aria-label="הפחת עותק"
              disabled={disabled || item.copies <= 1}
              onClick={() => patch({ copies: Math.max(1, item.copies - 1) })}
            >
              −
            </button>
            <input
              className="ds-input printing-item__copies-input"
              type="number"
              min={1}
              max={MAX_PRINT_COPIES}
              step={1}
              value={item.copies}
              aria-label="מספר עותקים"
              disabled={disabled}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                patch({ copies: Math.min(MAX_PRINT_COPIES, Math.max(1, Math.trunc(n))) })
              }}
            />
            <button
              type="button"
              className="ds-btn ds-btn--secondary"
              aria-label="הוסף עותק"
              disabled={disabled || item.copies >= MAX_PRINT_COPIES}
              onClick={() => patch({ copies: Math.min(MAX_PRINT_COPIES, item.copies + 1) })}
            >
              +
            </button>
          </div>
        </div>

        <fieldset className="printing-item__fieldset" disabled={disabled}>
          <legend className="ds-label">צבע</legend>
          <div className="printing-item__choice-row" role="radiogroup" aria-label="מצב צבע">
            <label className="printing-item__choice">
              <input
                type="radio"
                name={`color-${item.localId}`}
                checked={item.color_mode === 'black_and_white'}
                onChange={() => patch({ color_mode: 'black_and_white' })}
              />
              שחור־לבן
            </label>
            <label className="printing-item__choice">
              <input
                type="radio"
                name={`color-${item.localId}`}
                checked={item.color_mode === 'color'}
                onChange={() => patch({ color_mode: 'color' })}
              />
              צבעוני
            </label>
          </div>
        </fieldset>

        <label className="printing-item__field">
          <span className="ds-label">גודל נייר</span>
          <select
            className="ds-select"
            value={item.paper_size}
            disabled={disabled}
            onChange={(e) => patch({ paper_size: e.target.value as PrintingDraftItem['paper_size'] })}
          >
            {PRINTING_PAPER_SIZE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="printing-item__fieldset" disabled={disabled}>
          <legend className="ds-label">כיוון</legend>
          <div className="printing-item__choice-row" role="radiogroup" aria-label="כיוון">
            <label className="printing-item__choice">
              <input
                type="radio"
                name={`orient-${item.localId}`}
                checked={item.orientation === 'portrait'}
                onChange={() => patch({ orientation: 'portrait' })}
              />
              לאורך
            </label>
            <label className="printing-item__choice">
              <input
                type="radio"
                name={`orient-${item.localId}`}
                checked={item.orientation === 'landscape'}
                onChange={() => patch({ orientation: 'landscape' })}
              />
              לרוחב
            </label>
          </div>
        </fieldset>

        <fieldset className="printing-item__fieldset" disabled={disabled}>
          <legend className="ds-label">צדדים</legend>
          <div className="printing-item__choice-row" role="radiogroup" aria-label="צדדים">
            <label className="printing-item__choice">
              <input
                type="radio"
                name={`sides-${item.localId}`}
                checked={item.sides === 'single_sided'}
                onChange={() => patch({ sides: 'single_sided' })}
              />
              חד־צדדי
            </label>
            <label className="printing-item__choice">
              <input
                type="radio"
                name={`sides-${item.localId}`}
                checked={item.sides === 'double_sided'}
                onChange={() =>
                  patch({
                    sides: 'double_sided',
                    duplex_flip_mode: item.duplex_flip_mode ?? 'long_edge',
                  })
                }
              />
              דו־צדדי
            </label>
          </div>
          {item.sides === 'double_sided' ? (
            <div className="printing-item__choice-row" role="radiogroup" aria-label="היפוך דו־צדדי">
              <label className="printing-item__choice">
                <input
                  type="radio"
                  name={`flip-${item.localId}`}
                  checked={item.duplex_flip_mode === 'long_edge'}
                  onChange={() => patch({ duplex_flip_mode: 'long_edge' })}
                />
                היפוך בצד הארוך
              </label>
              <label className="printing-item__choice">
                <input
                  type="radio"
                  name={`flip-${item.localId}`}
                  checked={item.duplex_flip_mode === 'short_edge'}
                  onChange={() => patch({ duplex_flip_mode: 'short_edge' })}
                />
                היפוך בצד הקצר
              </label>
            </div>
          ) : null}
        </fieldset>

        <button type="button" className="ds-btn ds-btn--secondary" onClick={onToggleMore}>
          {moreOpen ? 'הסתר הגדרות נוספות' : 'הגדרות נוספות'}
        </button>

        {moreOpen ? (
          <div className="printing-item__more">
            <label className="printing-item__field">
              <span className="ds-label">עמודים בדף</span>
              <select
                className="ds-select"
                value={item.pages_per_sheet}
                disabled={disabled}
                onChange={(e) =>
                  patch({ pages_per_sheet: Number(e.target.value) as PrintingDraftItem['pages_per_sheet'] })
                }
              >
                {PRINTING_PAGES_PER_SHEET_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="printing-item__fieldset" disabled={disabled}>
              <legend className="ds-label">קנה מידה</legend>
              <div className="printing-item__choice-row" role="radiogroup" aria-label="קנה מידה">
                <label className="printing-item__choice">
                  <input
                    type="radio"
                    name={`scale-${item.localId}`}
                    checked={item.scale_mode === 'fit_to_page'}
                    onChange={() => patch({ scale_mode: 'fit_to_page' })}
                  />
                  התאמה לדף
                </label>
                <label className="printing-item__choice">
                  <input
                    type="radio"
                    name={`scale-${item.localId}`}
                    checked={item.scale_mode === 'original_100'}
                    onChange={() => patch({ scale_mode: 'original_100' })}
                  />
                  100%
                </label>
                <label className="printing-item__choice">
                  <input
                    type="radio"
                    name={`scale-${item.localId}`}
                    checked={item.scale_mode === 'custom'}
                    onChange={() =>
                      patch({
                        scale_mode: 'custom',
                        custom_scale_percent: item.custom_scale_percent ?? 100,
                      })
                    }
                  />
                  מותאם
                </label>
              </div>
              {item.scale_mode === 'custom' ? (
                <label className="printing-item__field printing-item__scale-custom">
                  <span className="ds-label">אחוז</span>
                  <input
                    className="ds-input"
                    type="number"
                    min={10}
                    max={400}
                    value={item.custom_scale_percent ?? 100}
                    disabled={disabled}
                    onChange={(e) =>
                      patch({ custom_scale_percent: Math.trunc(Number(e.target.value)) || 100 })
                    }
                  />
                  <span aria-hidden="true">%</span>
                </label>
              ) : null}
            </fieldset>

            <fieldset className="printing-item__fieldset" disabled={disabled}>
              <legend className="ds-label">מיון עותקים</legend>
              <p className="printing-item__hint">
                ממוין: קבצים שלמים ברצף. לא ממוין: כל עמוד בכל העותקים יחד.
              </p>
              <div className="printing-item__choice-row" role="radiogroup" aria-label="מיון עותקים">
                <label className="printing-item__choice">
                  <input
                    type="radio"
                    name={`collate-${item.localId}`}
                    checked={item.collate}
                    onChange={() => patch({ collate: true })}
                  />
                  ממוין
                </label>
                <label className="printing-item__choice">
                  <input
                    type="radio"
                    name={`collate-${item.localId}`}
                    checked={!item.collate}
                    onChange={() => patch({ collate: false })}
                  />
                  לא ממוין
                </label>
              </div>
            </fieldset>

            <label className="printing-item__field">
              <span className="ds-label">הערות לקובץ זה</span>
              <textarea
                className="ds-textarea"
                rows={2}
                value={item.notes ?? ''}
                disabled={disabled}
                placeholder="לדוגמה: נא לשדך כל חוברת בנפרד"
                onChange={(e) => patch({ notes: e.target.value || null })}
              />
            </label>
          </div>
        ) : (
          <p className="printing-item__summary-line">
            {item.pages_per_sheet} בדף ·{' '}
            {item.scale_mode === 'fit_to_page'
              ? 'התאמה לדף'
              : item.scale_mode === 'original_100'
                ? '100%'
                : `${item.custom_scale_percent ?? 100}%`}{' '}
            · {item.collate ? 'ממוין' : 'לא ממוין'}
            {item.notes ? ` · הערה: ${item.notes}` : ''}
          </p>
        )}

        {settingsError ? (
          <p className="ds-form-message ds-form-message--error" role="alert">
            {settingsError}
          </p>
        ) : null}
      </div>
    </article>
  )
}
