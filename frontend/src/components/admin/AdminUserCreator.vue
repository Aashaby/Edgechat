<script setup>
import { computed, reactive, ref } from 'vue';
import api from '../../api.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';
import { t } from '../../i18n.js';

const emit = defineEmits(['created']);
const submitting = ref(false);
const error = ref('');
const success = ref('');
const form = reactive({ username: '', displayName: '', password: '' });

const canSubmit = computed(() => Boolean(form.username && form.displayName && form.password));

async function submitUser() {
  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    const payload = await api.createUser(form);
    form.username = '';
    form.displayName = '';
    form.password = '';
    success.value = t('userCreator.created');
    emit('created', payload.user);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <UiSurface class="panel admin-user-creator">
    <h3 class="panel-title">{{ t('userCreator.title') }}</h3>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-else-if="success" class="success-text" role="status">{{ success }}</p>
    <form class="admin-user-creator__form" @submit.prevent="submitUser">
      <div class="admin-user-creator__identity-grid">
        <label class="field">
          <span>{{ t('auth.username') }}</span>
          <input v-model.trim="form.username" autocomplete="off" />
        </label>
        <label class="field">
          <span>{{ t('auth.displayName') }}</span>
          <input v-model.trim="form.displayName" autocomplete="off" />
        </label>
      </div>
      <label class="field">
        <span>{{ t('userCreator.initialPassword') }}</span>
        <input v-model="form.password" type="password" autocomplete="new-password" />
      </label>
      <div class="admin-user-creator__actions">
        <UiButton type="submit" :disabled="submitting || !canSubmit">
          {{ submitting ? t('common.creating') : t('userCreator.title') }}
        </UiButton>
      </div>
    </form>
  </UiSurface>
</template>

<style scoped src="../../styles/admin/user-creator.css"></style>
