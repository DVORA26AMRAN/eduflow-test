import './InstallMpexButton.css'
import { useMpexInstall } from './useMpexInstall'

export const INSTALL_LABEL = 'התקנת MPEX'

type InstallMpexButtonProps = {
  /** Visual placement: login card vs dashboard header */
  variant?: 'login' | 'header'
}

/**
 * Shared Hebrew install control for login + authenticated shell.
 * Does not auto-prompt; only reacts to explicit user clicks.
 */
export function InstallMpexButton({ variant = 'login' }: InstallMpexButtonProps) {
  const {
    mode,
    isInstalled,
    showIosInstructions,
    showManualHint,
    install,
    dismissIosInstructions,
    dismissManualHint,
  } = useMpexInstall()

  if (isInstalled || mode === 'installed') {
    return null
  }

  return (
    <div
      className={`install-mpex install-mpex--${variant}`}
      data-install-mode={mode}
      data-testid="install-mpex"
    >
      <button
        type="button"
        className={
          variant === 'header'
            ? 'ds-btn ds-btn--secondary install-mpex__button'
            : 'ds-btn ds-btn--secondary install-mpex__button install-mpex__button--login'
        }
        onClick={() => {
          void install()
        }}
        aria-haspopup={
          mode === 'ios_instructions' || showManualHint ? 'dialog' : undefined
        }
      >
        {INSTALL_LABEL}
      </button>

      {showIosInstructions ? (
        <div
          className="install-mpex__ios"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-mpex-ios-title"
          data-testid="install-mpex-ios-instructions"
        >
          <div className="install-mpex__ios-card">
            <h2 id="install-mpex-ios-title" className="install-mpex__ios-title">
              הוספת MPEX למסך הבית
            </h2>
            <ol className="install-mpex__ios-steps">
              <li>הקישו על כפתור השיתוף בתחתית Safari (הריבוע עם החץ).</li>
              <li>גללו ובחרו &quot;הוסף למסך הבית&quot;.</li>
              <li>אשרו את השם MPEX והקישו על &quot;הוסף&quot;.</li>
            </ol>
            <button
              type="button"
              className="ds-btn ds-btn--primary install-mpex__ios-close"
              onClick={dismissIosInstructions}
            >
              הבנתי
            </button>
          </div>
        </div>
      ) : null}

      {showManualHint ? (
        <div
          className="install-mpex__ios"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-mpex-hint-title"
          data-testid="install-mpex-manual-hint"
        >
          <div className="install-mpex__ios-card">
            <h2 id="install-mpex-hint-title" className="install-mpex__ios-title">
              התקנת MPEX
            </h2>
            <p className="install-mpex__hint-text">
              בדפדפן זה ניתן להתקין דרך תפריט הדפדפן (למשל &quot;התקן את האפליקציה&quot;
              ב-Chrome), או להוסיף את MPEX למסך הבית ב-Safari באייפון.
            </p>
            <button
              type="button"
              className="ds-btn ds-btn--primary install-mpex__ios-close"
              onClick={dismissManualHint}
            >
              הבנתי
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
