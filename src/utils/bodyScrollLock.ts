import { useEffect } from 'react'

type BodyStyleSnapshot = {
  position: string
  top: string
  left: string
  right: string
  width: string
  overflow: string
}

let lockCount = 0
let capturedScrollY = 0
let capturedStyles: BodyStyleSnapshot | null = null

export function acquireBodyScrollLock(): void {
  if (lockCount === 0) {
    capturedScrollY = window.scrollY
    capturedStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    }

    document.body.style.position = 'fixed'
    document.body.style.top = `-${capturedScrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
  }

  lockCount += 1
}

export function releaseBodyScrollLock(): void {
  if (lockCount === 0) {
    return
  }

  lockCount -= 1

  if (lockCount > 0) {
    return
  }

  if (!capturedStyles) {
    return
  }

  document.body.style.position = capturedStyles.position
  document.body.style.top = capturedStyles.top
  document.body.style.left = capturedStyles.left
  document.body.style.right = capturedStyles.right
  document.body.style.width = capturedStyles.width
  document.body.style.overflow = capturedStyles.overflow
  window.scrollTo(0, capturedScrollY)

  capturedStyles = null
  capturedScrollY = 0
}

export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) {
      return
    }

    acquireBodyScrollLock()

    return () => {
      releaseBodyScrollLock()
    }
  }, [isLocked])
}

export function getBodyScrollLockCountForTests(): number {
  return lockCount
}

export function resetBodyScrollLockForTests(): void {
  if (lockCount > 0 && capturedStyles) {
    document.body.style.position = capturedStyles.position
    document.body.style.top = capturedStyles.top
    document.body.style.left = capturedStyles.left
    document.body.style.right = capturedStyles.right
    document.body.style.width = capturedStyles.width
    document.body.style.overflow = capturedStyles.overflow
    window.scrollTo(0, capturedScrollY)
  }

  lockCount = 0
  capturedStyles = null
  capturedScrollY = 0
}
