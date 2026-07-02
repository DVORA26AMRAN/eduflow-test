type LoadingPageProps = {
  message: string
  maxWidth?: number
}

export function LoadingPage({ message, maxWidth = 500 }: LoadingPageProps) {
  return (
    <main dir="rtl" style={{ padding: 40, maxWidth }}>
      <p>{message}</p>
    </main>
  )
}
