import { reactive } from 'vue';
import {
  getStoredNativeServerOrigin,
  isCapacitorAndroid,
  restoreStoredNativeServerOrigin,
  resolveServerAssetUrl,
  setStoredNativeServerOrigin
} from './capacitor-platform.ts';
import { isDemoMode, runtimeSessionToken } from './runtime.js';
import api from './api.js';
import {
  addAuthInvalidListener,
  clearStoredToken,
  getStoredToken,
  setStoredToken
} from './auth-storage.js';

const DEFAULT_SITE_ICON_URL = '/logo.svg';

const state = reactive({
  ready: false,
  token: isDemoMode ? runtimeSessionToken : getStoredToken(),
  session: null,
  site: {
    siteName: 'Edgechat',
    siteIconUrl: ''
  }
});

function clearAuthState() {
  clearStoredToken();
  state.token = '';
  state.session = null;
}

function applySiteMetadata(site) {
  const siteName = String(site?.siteName || 'Edgechat').trim() || 'Edgechat';
  const siteIconUrl = String(site?.siteIconUrl || '').trim();
  document.title = siteName;

  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.setAttribute('rel', 'icon');
    document.head.appendChild(favicon);
  }

  if (siteIconUrl) {
    favicon.setAttribute('href', resolveServerAssetUrl(siteIconUrl));
  } else {
    favicon.setAttribute('href', DEFAULT_SITE_ICON_URL);
  }
}

async function loadSite() {
  try {
    const payload = await api.getSite();
    setSite(payload.site);
  } catch {
    applySiteMetadata(state.site);
  }
}

async function initialize() {
  if (state.ready) {
    return;
  }

  if (isCapacitorAndroid && !getStoredNativeServerOrigin()) {
    clearAuthState();
    state.ready = true;
    return;
  }

  await loadSite();

  if (!state.token) {
    state.ready = true;
    return;
  }

  try {
    const payload = await api.session();
    state.session = payload.session;
  } catch {
    clearAuthState();
  } finally {
    state.ready = true;
  }
}

async function login(credentials) {
  const payload = await api.login(credentials);
  state.token = payload.token;
  state.session = payload.session;
  state.ready = true;
  setStoredToken(payload.token);
}

async function configureNativeServer(configuredOrigin) {
  if (!isCapacitorAndroid) {
    return '';
  }

  const previousOrigin = getStoredNativeServerOrigin();
  const nextOrigin = setStoredNativeServerOrigin(configuredOrigin);
  try {
    const payload = await api.getSite();
    if (nextOrigin !== previousOrigin) {
      clearAuthState();
    }
    setSite(payload.site);
    return nextOrigin;
  } catch (error) {
    restoreStoredNativeServerOrigin(previousOrigin);
    throw new Error('native_server_unavailable', { cause: error });
  }
}

async function logout() {
  try {
    if (state.token) {
      await api.logout();
    }
  } finally {
    clearAuthState();
  }
}

function setSession(session) {
  state.session = session;
}

function setSite(site) {
  state.site = {
    siteName: String(site?.siteName || 'Edgechat').trim() || 'Edgechat',
    siteIconUrl: String(site?.siteIconUrl || '').trim()
  };
  applySiteMetadata(state.site);
}

if (typeof window !== 'undefined') {
  addAuthInvalidListener(() => {
    clearAuthState();
  });
}

export default {
  get ready() {
    return state.ready;
  },
  get token() {
    return state.token;
  },
  get session() {
    return state.session;
  },
  get site() {
    return state.site;
  },
  initialize,
  login,
  configureNativeServer,
  logout,
  setSession,
  setSite,
  loadSite
};
