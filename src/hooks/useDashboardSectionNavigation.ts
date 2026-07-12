import { useCallback } from 'react'

export function useDashboardSectionNavigation(
  setActiveSectionId: (sectionId: string) => void,
) {
  return useCallback(
    (sectionId: string) => {
      setActiveSectionId(sectionId)
    },
    [setActiveSectionId],
  )
}
