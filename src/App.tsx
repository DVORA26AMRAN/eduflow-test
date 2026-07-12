import type { Session } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import './App.css'
import { LoadingPage } from './components/LoadingPage'
import { ProfileLoadErrorPage } from './components/ProfileLoadErrorPage'
import { LoginPage } from './pages/LoginPage'
import { ManagerDashboardPage } from './pages/ManagerDashboardPage'
import { PasswordSetupPage } from './pages/PasswordSetupPage'
import { PlatformAdminDashboardPage } from './pages/PlatformAdminDashboardPage'
import { SecretaryDashboardPage } from './pages/SecretaryDashboardPage'
import { TeacherDashboardPage } from './pages/TeacherDashboardPage'
import {
  clearAuthCallbackFromUrl,
  detectAuthCallback,
  hasCompletedPasswordSetup,
} from './services/auth'
import { loadCurrentUserProfile, logAuthState, logProfileDebug } from './services/profile'
import { PENDING_PASSWORD_SETUP_KEY, supabase } from './services/supabase'
import type {
  AuthenticatedUserProfile,
  ProfileLoadDebugInfo,
  UserRole,
} from './types/user'

function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [authReady, setAuthReady] = useState(false)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [profileLoadError, setProfileLoadError] = useState('')
  const [profileLoadDebug, setProfileLoadDebug] = useState<ProfileLoadDebugInfo | null>(
    null,
  )
  const [currentProfile, setCurrentProfile] = useState<AuthenticatedUserProfile | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSetupMessage, setPasswordSetupMessage] = useState('')
  const [isSavingPassword, setIsSavingPassword] = useState(false)

  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState<UserRole>('teacher')
  const [usersListVersion, setUsersListVersion] = useState(0)

  const profileLoadRequestId = useRef(0)
  const loadedProfileUserId = useRef<string | null>(null)
  const loadedProfile = useRef<AuthenticatedUserProfile | null>(null)

  async function syncAuthenticatedSession(
    session: Session | null,
    source: string,
    options?: { isAuthCallback?: boolean; isInviteFlow?: boolean },
  ) {
    const requestId = ++profileLoadRequestId.current

    logProfileDebug('syncAuthenticatedSession called', {
      source,
      requestId,
      hasSession: !!session,
      sessionUserId: session?.user.id ?? null,
      loadedProfileUserId: loadedProfileUserId.current,
      loadedProfileRole: loadedProfile.current?.role ?? null,
    })

    if (!session?.user) {
      loadedProfileUserId.current = null
      loadedProfile.current = null
      setCurrentProfile(null)
      setNeedsPasswordSetup(false)
      setProfileLoadError('')
      setProfileLoadDebug(null)
      setIsProfileLoading(false)
      return
    }

    const pendingSetup =
      sessionStorage.getItem(PENDING_PASSWORD_SETUP_KEY) === 'true'
    const setupComplete = hasCompletedPasswordSetup(session.user)
    const shouldSetupPassword =
      !setupComplete &&
      (pendingSetup ||
        (options?.isAuthCallback === true && options?.isInviteFlow === true))

    if (shouldSetupPassword) {
      logProfileDebug('password setup required, skipping profile load', {
        source,
        pendingSetup,
        setupComplete,
      })
      setNeedsPasswordSetup(true)
      setCurrentProfile(null)
      setProfileLoadError('')
      setProfileLoadDebug(null)
      setIsProfileLoading(false)
      return
    }

    if (
      loadedProfileUserId.current === session.user.id &&
      loadedProfile.current !== null
    ) {
      logProfileDebug('profile already loaded for user, skipping reload', {
        source,
        userId: session.user.id,
        role: loadedProfile.current.role,
      })
      setCurrentProfile(loadedProfile.current)
      setNeedsPasswordSetup(false)
      setProfileLoadError('')
      setProfileLoadDebug(null)
      setIsProfileLoading(false)
      return
    }

    setNeedsPasswordSetup(false)
    setIsProfileLoading(true)
    setProfileLoadError('')
    setProfileLoadDebug(null)

    await logAuthState(`${source}:before-users-query`)

    try {
      const result = await loadCurrentUserProfile(session, source)

      if (requestId !== profileLoadRequestId.current) {
        logProfileDebug('stale profile load ignored', {
          source,
          requestId,
          latestRequestId: profileLoadRequestId.current,
          result,
        })
        return
      }

      if (!result.ok) {
        if (
          loadedProfileUserId.current === session.user.id &&
          loadedProfile.current !== null
        ) {
          console.warn('[profile] ignoring failure because profile already loaded', {
            source,
            userId: session.user.id,
            role: loadedProfile.current.role,
            debug: result.debug,
          })
          setCurrentProfile(loadedProfile.current)
          setProfileLoadError('')
          setProfileLoadDebug(null)
          return
        }

        loadedProfileUserId.current = null
        loadedProfile.current = null
        setCurrentProfile(null)
        setProfileLoadError('לא ניתן לטעון את פרופיל המשתמש.')
        setProfileLoadDebug(result.debug)

        console.error('[profile] setting profileLoadError', {
          source,
          requestId,
          userId: session.user.id,
          debug: result.debug,
        })
        return
      }

      loadedProfileUserId.current = session.user.id
      loadedProfile.current = result.profile
      setCurrentProfile(result.profile)
      setProfileLoadError('')
      setProfileLoadDebug(null)

      logProfileDebug('profile loaded successfully', {
        source,
        requestId,
        userId: session.user.id,
        role: result.profile.role,
      })
    } catch (error) {
      if (requestId !== profileLoadRequestId.current) {
        logProfileDebug('stale failed profile load ignored', {
          source,
          requestId,
          latestRequestId: profileLoadRequestId.current,
          error,
        })
        return
      }

      loadedProfileUserId.current = null
      loadedProfile.current = null
      setCurrentProfile(null)
      setProfileLoadError('לא ניתן לטעון את פרופיל המשתמש.')
      setProfileLoadDebug({
        sessionUserId: session.user.id,
        sessionEmail: session.user.email ?? null,
        queryUserId: session.user.id,
        errorMessage: error instanceof Error ? error.message : 'שגיאה לא צפויה',
        errorCode: null,
        dataWasNull: true,
      })

      console.error('[profile] setting profileLoadError', {
        source,
        requestId,
        userId: session.user.id,
        error,
      })
    } finally {
      if (requestId === profileLoadRequestId.current) {
        setIsProfileLoading(false)
      }
    }
  }

  useEffect(() => {
    const { isAuthCallback, isInviteFlow } = detectAuthCallback()

    if (isAuthCallback && isInviteFlow) {
      sessionStorage.setItem(PENDING_PASSWORD_SETUP_KEY, 'true')
    }

    async function initAuth() {
      const { data } = await supabase.auth.getSession()
      await syncAuthenticatedSession(data.session, 'initAuth', {
        isAuthCallback,
        isInviteFlow,
      })
      clearAuthCallbackFromUrl()
      setAuthReady(true)
    }

    void initAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      logProfileDebug('onAuthStateChange', {
        event,
        sessionUserId: session?.user.id ?? null,
      })

      if (event === 'SIGNED_OUT') {
        window.setTimeout(() => {
          void syncAuthenticatedSession(null, 'onAuthStateChange:SIGNED_OUT')
        }, 0)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function login() {
    setProfileLoadError('')
    setProfileLoadDebug(null)
    loadedProfileUserId.current = null
    loadedProfile.current = null
    setCurrentProfile(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setMessage('ההתחברות נכשלה. בדקי מייל וסיסמה.')
      return
    }

    if (!data.session) {
      console.error('[profile] signInWithPassword succeeded without session', data)
      setProfileLoadError('לא ניתן לטעון את פרופיל המשתמש.')
      setProfileLoadDebug({
        sessionUserId: null,
        sessionEmail: email || null,
        queryUserId: null,
        errorMessage: 'ההתחברות הצליחה אך לא התקבלה הפעלה',
        errorCode: null,
        dataWasNull: true,
      })
      return
    }

    sessionStorage.removeItem(PENDING_PASSWORD_SETUP_KEY)
    setMessage('התחברת בהצלחה.')

    logProfileDebug('login succeeded', {
      userId: data.session.user.id,
      email: data.session.user.email,
    })

    await syncAuthenticatedSession(data.session, 'login')
  }

  async function savePassword() {
    setPasswordSetupMessage('')

    if (!newPassword || !confirmPassword) {
      setPasswordSetupMessage('נא למלא את כל השדות.')
      return
    }

    if (newPassword.length < 8) {
      setPasswordSetupMessage('הסיסמה חייבת להיות באורך של לפחות 8 תווים.')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordSetupMessage('הסיסמאות אינן תואמות.')
      return
    }

    setIsSavingPassword(true)

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { password_setup_complete: true },
    })

    setIsSavingPassword(false)

    if (error) {
      setPasswordSetupMessage('שמירת הסיסמה נכשלה. נסי שוב.')
      return
    }

    sessionStorage.removeItem(PENDING_PASSWORD_SETUP_KEY)
    setNeedsPasswordSetup(false)
    setNewPassword('')
    setConfirmPassword('')
    setMessage('הסיסמה נשמרה בהצלחה. אפשר להתחבר למערכת.')
    loadedProfileUserId.current = null
    loadedProfile.current = null
    setCurrentProfile(null)

    await supabase.auth.signOut()
  }

  async function createUser() {
    if (!newUserName || !newUserEmail) {
      setMessage('נא למלא שם מלא וכתובת מייל.')
      return
    }

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token

    if (!token) {
      setMessage('אין התחברות פעילה.')
      return
    }

    const response = await fetch(
      'https://kkafmsvntwqweudallty.supabase.co/functions/v1/clever-processor',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          full_name: newUserName,
          email: newUserEmail,
          role: newUserRole,
          capabilities: [],
        }),
      },
    )

    const responseBodyText = await response.text()

    console.log('[createUser] Edge Function response', {
      status: response.status,
      body: responseBodyText,
    })

    if (response.status === 201) {
      setMessage('המשתמש נוצר בהצלחה.')
      setNewUserName('')
      setNewUserEmail('')
      setNewUserRole('teacher')
      setUsersListVersion((version) => version + 1)
      return
    }

    if (response.status === 401) {
      setMessage('ההתחברות פגה. נא להתחבר מחדש.')
      return
    }

    if (response.status === 403) {
      setMessage('אין לך הרשאה לבצע פעולה זו.')
      return
    }

    if (response.status === 409) {
      setMessage('משתמש עם כתובת המייל הזו כבר קיים.')
      return
    }

    setMessage(`יצירת המשתמש נכשלה: ${responseBodyText}`)
  }

  async function logout() {
    profileLoadRequestId.current += 1
    loadedProfileUserId.current = null
    loadedProfile.current = null
    await supabase.auth.signOut()
    setCurrentProfile(null)
    setProfileLoadError('')
    setProfileLoadDebug(null)
    setIsProfileLoading(false)
    sessionStorage.removeItem(PENDING_PASSWORD_SETUP_KEY)
  }

  if (!authReady) {
    return <LoadingPage message="טוען..." />
  }

  if (needsPasswordSetup) {
    return (
      <PasswordSetupPage
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        passwordSetupMessage={passwordSetupMessage}
        isSavingPassword={isSavingPassword}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onSavePassword={savePassword}
      />
    )
  }

  if (isProfileLoading) {
    return <LoadingPage message="טוען פרופיל משתמש..." />
  }

  if (profileLoadError) {
    return (
      <ProfileLoadErrorPage
        errorMessage={profileLoadError}
        debugInfo={profileLoadDebug}
      />
    )
  }

  if (!currentProfile) {
    return (
      <LoginPage
        email={email}
        password={password}
        message={message}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onLogin={login}
      />
    )
  }

  if (currentProfile.role === 'platform_admin') {
    return <PlatformAdminDashboardPage profile={currentProfile} onLogout={logout} />
  }

  if (currentProfile.role === 'secretary') {
    return <SecretaryDashboardPage profile={currentProfile} onLogout={logout} />
  }

  if (currentProfile.role === 'teacher') {
    return <TeacherDashboardPage profile={currentProfile} onLogout={logout} />
  }

  return (
    <ManagerDashboardPage
      profile={currentProfile}
      newUserName={newUserName}
      newUserEmail={newUserEmail}
      newUserRole={newUserRole}
      message={message}
      usersListVersion={usersListVersion}
      onNewUserNameChange={setNewUserName}
      onNewUserEmailChange={setNewUserEmail}
      onNewUserRoleChange={setNewUserRole}
      onCreateUser={createUser}
      onLogout={logout}
    />
  )
}

export default App
