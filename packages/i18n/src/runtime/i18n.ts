import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import authenticationEnUS from '../locales/en-US/authentication.json'
import commonEnUS from '../locales/en-US/common.json'
import itemsEnUS from '../locales/en-US/items.json'
import authenticationZhCN from '../locales/zh-CN/authentication.json'
import commonZhCN from '../locales/zh-CN/common.json'
import itemsZhCN from '../locales/zh-CN/items.json'
import { DEFAULT_LOCALE } from '../locale/locale.constants'

export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: 'common',
  ns: ['common', 'authentication', 'items'],
  interpolation: { escapeValue: false },
  resources: {
    'zh-CN': {
      common: commonZhCN,
      authentication: authenticationZhCN,
      items: itemsZhCN,
    },
    'en-US': {
      common: commonEnUS,
      authentication: authenticationEnUS,
      items: itemsEnUS,
    },
  },
})
