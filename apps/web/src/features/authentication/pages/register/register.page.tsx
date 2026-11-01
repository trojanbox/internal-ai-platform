import { useTranslation } from '@repo/i18n'
import { useActionData, useNavigation } from 'react-router-dom'

import { AuthPageLayout } from '../../components/auth-page-layout/auth-page-layout'

export function RegisterPage() {
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
      title={t('register.title')}
      description={t('register.description')}
      submitLabel={t('register.submit')}
      busy={navigation.state === 'submitting'}
      errorMessage={errorMessage}
      switchTo="/login"
      switchLabel={t('register.switch')}
    >
      <label>
        <span>{t('fields.email')}</span>
        <input autoComplete="email" name="email" type="email" required />
      </label>
      <label>
        <span>{t('fields.password')}</span>
        <input
          autoComplete="new-password"
          minLength={15}
          name="password"
          type="password"
          required
        />
        <small>{t('fields.passwordHint')}</small>
      </label>
    </AuthPageLayout>
  )
}
