import { useTranslation } from '@repo/i18n'
import { useActionData, useNavigation } from 'react-router-dom'

import { AuthPageLayout } from '../../components/auth-page-layout/auth-page-layout'

export function LoginPage() {
  const { t } = useTranslation('authentication')
  const { t: tCommon } = useTranslation('common')
  const actionData = useActionData() as { errorCode?: string } | undefined
  const navigation = useNavigation()
  const errorMessage = actionData?.errorCode
    ? tCommon(`errors.${actionData.errorCode}`, { defaultValue: tCommon('errors.UNKNOWN') })
    : undefined

  return (
    <AuthPageLayout
      appName={tCommon('appName')}
      title={t('login.title')}
      description={t('login.description')}
      submitLabel={t('login.submit')}
      busy={navigation.state === 'submitting'}
      errorMessage={errorMessage}
      switchTo="/register"
      switchLabel={t('login.switch')}
    >
      <label>
        <span>{t('fields.email')}</span>
        <input autoComplete="email" name="email" type="email" required />
      </label>
      <label>
        <span>{t('fields.password')}</span>
        <input
          autoComplete="current-password"
          minLength={15}
          name="password"
          type="password"
          required
        />
      </label>
    </AuthPageLayout>
  )
}
