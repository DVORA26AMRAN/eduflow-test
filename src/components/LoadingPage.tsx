type LoadingPageProps = {
  message: string
  maxWidth?: number
}

export function LoadingPage({ message, maxWidth = 500 }: LoadingPageProps) {
  return (
    <main
      dir="rtl"
      className="ds-page-shell ds-page-shell--narrow"
      style={{ maxWidth }}
    >
      <section className="ds-state" aria-live="polite">
        <p className="ds-state__message">{message}</p>
      </section>
    </main>
  )
}
