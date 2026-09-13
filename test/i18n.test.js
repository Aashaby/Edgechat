import assert from 'node:assert/strict';
import test from 'node:test';
import enUS from '../frontend/src/locales/en-US.js';
import zhCN from '../frontend/src/locales/zh-CN.js';
import {
  CHINESE_LOCALE,
  detectBrowserLocale,
  ENGLISH_LOCALE,
  formatDate,
  getLocale,
  setLocale,
  t,
  toggleLocale
} from '../frontend/src/i18n.js';
import { localizeErrorMessage } from '../frontend/src/localized-error.js';

test('中英文语言包保持相同键集合', () => {
  assert.deepEqual(Object.keys(enUS).sort(), Object.keys(zhCN).sort());
});

test('中文界面支持插值与未知键回退', () => {
  setLocale(CHINESE_LOCALE);
  assert.equal(getLocale(), CHINESE_LOCALE);
  assert.equal(t('chat.memberCount', { count: 3 }), '3 位成员');
  assert.equal(t('missing.translation.key'), 'missing.translation.key');
});

test('所有中文浏览器语言默认中文，其余语言默认英文', () => {
  for (const language of [
    'zh',
    'zh-CN',
    'zh-Hans-SG',
    'zh-MY',
    'zh-TW',
    'zh-Hant-HK',
    'zh-MO',
    'ZH_hant_tw'
  ]) {
    assert.equal(detectBrowserLocale(language), CHINESE_LOCALE);
  }

  for (const language of ['en-US', 'en-HK', 'ms-MY', 'ja-JP', '']) {
    assert.equal(detectBrowserLocale(language), ENGLISH_LOCALE);
  }
});

test('语言切换会持久化选择', () => {
  const stored = new Map();
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value)
  };

  try {
    setLocale(CHINESE_LOCALE);
    toggleLocale();
    assert.equal(getLocale(), ENGLISH_LOCALE);
    assert.equal(stored.get('edgechat.locale'), ENGLISH_LOCALE);
    assert.equal(t('auth.signIn'), 'Sign in');
  } finally {
    setLocale(CHINESE_LOCALE);
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test('日期格式跟随当前语言', () => {
  const value = new Date('2026-08-18T12:00:00.000Z');
  const options = { dateStyle: 'long', timeZone: 'UTC' };

  setLocale(CHINESE_LOCALE);
  const chinese = formatDate(value, options);
  setLocale(ENGLISH_LOCALE);
  const english = formatDate(value, options);

  assert.equal(chinese, new Intl.DateTimeFormat(CHINESE_LOCALE, options).format(value));
  assert.equal(english, new Intl.DateTimeFormat(ENGLISH_LOCALE, options).format(value));
  assert.notEqual(chinese, english);
  setLocale(CHINESE_LOCALE);
});

test('服务端固定与动态错误会按当前语言本地化', () => {
  setLocale(ENGLISH_LOCALE);
  assert.equal(localizeErrorMessage('账号或密码错误'), 'Incorrect username or password');
  assert.equal(
    localizeErrorMessage('封禁时长必须是正整数分钟'),
    'Ban duration must be a positive integer number of minutes'
  );
  assert.equal(localizeErrorMessage('文件大小不能超过 16MB'), 'File size cannot exceed 16 MB');

  setLocale(CHINESE_LOCALE);
  assert.equal(localizeErrorMessage('账号或密码错误'), '账号或密码错误');
});
