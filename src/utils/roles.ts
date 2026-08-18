import type { PrimaryRole } from '../types/user'

const roleLabels: Record<PrimaryRole, string> = {
  teacher: 'מורה',
  secretary: 'מזכירה',
  deputy: 'סגנית',
  institution_manager: 'מנהלת',
  platform_admin: 'מנהל/ת מערכת',
}

export function translateRole(role: PrimaryRole): string {
  return roleLabels[role]
}
