<script setup>
import { onMounted, reactive, ref } from 'vue';
import api from '../../api.js';
import store from '../../store.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';
import { t } from '../../i18n.js';

const loading = ref(false);
const error = ref('');
const saving = ref(false);
const iconUploading = ref(false);
const iconFileInputEl = ref(null);
const siteForm = reactive({ siteName: 'Edgechat', siteIconUrl: '' });

async function loadSiteSettings() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminSiteSettings();
    siteForm.siteName = payload.site?.siteName || 'Edgechat';
    siteForm.siteIconUrl = payload.site?.siteIconUrl || '';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

function openIconPicker() {
  iconFileInputEl.value?.click();
}

async function uploadSiteIcon(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  iconUploading.value = true;
  error.value = '';
  try {
    const payload = await api.uploadFile(file);
    siteForm.siteIconUrl = payload.file.url;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    iconUploading.value = false;
    event.target.value = '';
  }
}

async function saveSiteSettings() {
  saving.value = true;
  error.value = '';
  try {
    const payload = await api.updateAdminSiteSettings(siteForm);
    siteForm.siteName = payload.site.siteName;
    siteForm.siteIconUrl = payload.site.siteIconUrl;
    store.setSite(payload.site);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    saving.value = false;
  }
}

onMounted(loadSiteSettings);
</script>

<template>
  <UiSurface class="panel admin-site-appearance">
    <div class="admin-site-appearance__heading">
      <div>
        <h3 class="panel-title">{{ t('site.appearance.title') }}</h3>
        <p>{{ t('site.appearance.description') }}</p>
      </div>
      <UiButton variant="secondary" size="sm" :disabled="loading" @click="loadSiteSettings">
        {{ loading ? `${t('common.loading')}...` : t('site.reload') }}
      </UiButton>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>
    <label class="field">
      <span>{{ t('site.name') }}</span>
      <input v-model.trim="siteForm.siteName" :placeholder="t('site.namePlaceholder')" />
    </label>
    <label class="field">
      <span>{{ t('site.iconUrl') }}</span>
      <input v-model.trim="siteForm.siteIconUrl" :placeholder="t('site.iconUrlPlaceholder')" />
    </label>
    <div class="inline-actions">
      <input ref="iconFileInputEl" type="file" accept="image/*" hidden @change="uploadSiteIcon" />
      <UiButton variant="secondary" size="sm" :disabled="iconUploading" @click="openIconPicker">
        {{ iconUploading ? t('common.uploading') : t('site.uploadIcon') }}
      </UiButton>
      <UiButton :disabled="saving" @click="saveSiteSettings">
        {{ saving ? t('common.saving') : t('site.save') }}
      </UiButton>
    </div>
    <div class="admin-site-preview">
      <div class="admin-site-preview__icon">
        <img v-if="siteForm.siteIconUrl" :src="siteForm.siteIconUrl" :alt="t('site.iconAlt')" />
        <span v-else>{{ siteForm.siteName.slice(0, 1) || 'C' }}</span>
      </div>
      <div class="admin-site-preview__meta">
        <strong>{{ siteForm.siteName || 'Edgechat' }}</strong>
        <span>{{ siteForm.siteIconUrl || t('site.noIconUrl') }}</span>
      </div>
    </div>
  </UiSurface>
</template>

<style scoped src="../../styles/admin/site-appearance.css"></style>
