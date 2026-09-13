import { computed, readonly, ref } from 'vue';
import enUS from './locales/en-US.js';
import zhCN from './locales/zh-CN.js';

export const CHINESE_LOCALE = 'zh-CN';
export const ENGLISH_LOCALE = 'en-US';
const STORAGE_KEY = 'edgechat.locale';
const messages = {
  [CHINESE_LOCALE]: zhCN,
  [ENGLISH_LOCALE]: enUS
};

function normalizeLocale(value) {
  return value === CHINESE_LOCALE ? CHINESE_LOCALE : ENGLISH_LOCALE;
}

export function detectBrowserLocale(value) {
  return /^zh(?:[-_]|$)/i.test(String(value || '')) ? CHINESE_LOCALE : ENGLISH_LOCALE;
}

function initialLocale() {
  const storedLocale = typeof localStorage === 'undefined' ? '' : localStorage.getItem(STORAGE_KEY);
  if (storedLocale === CHINESE_LOCALE || storedLocale === ENGLISH_LOCALE) return storedLocale;
  const browserLanguage = globalThis.navigator?.languages?.[0] || globalThis.navigator?.language;
  return detectBrowserLocale(browserLanguage);
}

const locale = ref(initialLocale());

function interpolate(template, params) {
  return template.replace(/\{([a-zA-Z][\w]*)\}/g, (match, key) =>
    Object.hasOwn(params, key) ? String(params[key]) : match
  );
}

function applyDocumentLocale() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale.value;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', t('app.description'));
}

export function t(key, params = {}) {
  const template = messages[locale.value]?.[key] ?? messages[ENGLISH_LOCALE]?.[key] ?? key;
  return interpolate(template, params);
}

export function setLocale(value) {
  locale.value = normalizeLocale(value);
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale.value);
  applyDocumentLocale();
}

export function toggleLocale() {
  setLocale(locale.value === CHINESE_LOCALE ? ENGLISH_LOCALE : CHINESE_LOCALE);
}

export function formatDateTime(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale.value, options).format(date);
}

export function formatDate(value, options = { dateStyle: 'medium' }) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale.value, options).format(date);
}

export function formatTime(value, options = { hour: '2-digit', minute: '2-digit' }) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale.value, options).format(date);
}

export function compareLocalized(left, right) {
  return String(left).localeCompare(String(right), locale.value);
}

export function getLocale() {
  return locale.value;
}

export function useI18n() {
  return {
    locale: readonly(locale),
    isEnglish: computed(() => locale.value === ENGLISH_LOCALE),
    t,
    setLocale,
    toggleLocale,
    formatDate,
    formatDateTime,
    formatTime,
    compareLocalized
  };
}

applyDocumentLocale();
