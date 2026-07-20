import mpexLogo from '../assets/branding/m-transition-logo.png.png'
import './LoadingPage.css'

type LoadingPageProps = {
  message: string
}

export function LoadingPage({ message }: LoadingPageProps) {
  return (
    <main className="profile-loading-page" aria-busy="true">
      <img
        className="profile-loading-page__logo"
        src={mpexLogo}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <p className="profile-loading-page__status" role="status" aria-live="polite">
        {message}
      </p>
    </main>
  )
}
