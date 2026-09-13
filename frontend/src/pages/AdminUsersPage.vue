<script setup>
import { onMounted, ref } from 'vue';
import api from '../api.js';
import UserBanDialog from '../components/admin/UserBanDialog.vue';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';
import { formatDateTime, t } from '../i18n.js';

const loading = ref(false);
const error = ref('');
const users = ref([]);
const banDialogUser = ref(null);
const banSaving = ref(false);
const banError = ref('');

async function loadUsers() {
  loading.value = true;
  error.value = '';
  try {
    const usersPayload = await api.adminUsers();
    users.value = usersPayload.users;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

function openBanDialog(user) {
  banDialogUser.value = user;
  banError.value = '';
}

function closeBanDialog() {
  if (banSaving.value) return;
  banDialogUser.value = null;
  banError.value = '';
}

async function disableUser(durationMinutes) {
  const user = banDialogUser.value;
  if (!user) return;

  banSaving.value = true;
  banError.value = '';
  try {
    await api.updateUser(user.id, {
      isDisabled: true,
      banDurationMinutes: durationMinutes
    });
    banDialogUser.value = null;
    await loadUsers();
  } catch (currentError) {
    banError.value = currentError.message;
  } finally {
    banSaving.value = false;
  }
}

async function enableUser(user) {
  await api.updateUser(user.id, { isDisabled: false });
  await loadUsers();
}

function userStatus(user) {
  if (user.isPermanentlyDisabled) return t('users.status.permanent');
  if (user.disabledUntil) {
    return t('users.status.until', { time: formatDateTime(user.disabledUntil) });
  }
  return t('common.active');
}

async function resetPassword(user) {
  const password = window.prompt(t('users.promptNewPassword', { name: user.displayName }));
  if (!password) {
    return;
  }
  await api.resetPassword(user.id, password);
}

async function removeUser(user) {
  if (!window.confirm(t('users.confirmDelete', { name: user.displayName }))) {
    return;
  }
  await api.deleteUser(user.id);
  await loadUsers();
}

onMounted(loadUsers);
</script>

<template>
  <div class="admin-section">
    <header class="admin-section__header">
      <div class="admin-section__heading">
        <h2>{{ t('users.title') }}</h2>
        <p>{{ t('users.description') }}</p>
      </div>
      <UiButton variant="secondary" :disabled="loading" @click="loadUsers">
        {{ loading ? t('common.refreshing') : t('users.refresh') }}
      </UiButton>
    </header>

    <div class="admin-section__body">
      <p v-if="error" class="error-text">{{ error }}</p>

      <UiSurface class="panel panel--table">
        <h3 class="panel-title">{{ t('users.list') }}</h3>
        <div class="admin-table-wrap">
          <table class="list-table">
            <thead>
              <tr>
                <th>{{ t('users.columns.user') }}</th>
                <th>{{ t('users.columns.status') }}</th>
                <th>{{ t('users.columns.createdAt') }}</th>
                <th>{{ t('users.columns.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !users.length">
                <td colspan="4" class="muted">{{ t('users.loading') }}</td>
              </tr>
              <tr v-else-if="!users.length">
                <td colspan="4" class="muted">{{ t('users.empty') }}</td>
              </tr>
              <tr v-for="user in users" :key="user.id">
                <td>
                  <strong>{{ user.displayName }}</strong>
                  <div class="muted">@{{ user.username }}</div>
                </td>
                <td>{{ userStatus(user) }}</td>
                <td>{{ formatDateTime(user.createdAt) }}</td>
                <td>
                  <div class="inline-actions">
                    <UiButton v-if="user.isDisabled" variant="secondary" size="sm" @click="enableUser(user)">
                      {{ t('users.enable') }}
                    </UiButton>
                    <UiButton v-else variant="destructive" size="sm" @click="openBanDialog(user)">
                      {{ t('users.disable') }}
                    </UiButton>
                    <UiButton variant="secondary" size="sm" @click="resetPassword(user)">{{ t('users.resetPassword') }}</UiButton>
                    <UiButton variant="destructive" size="sm" @click="removeUser(user)">{{ t('common.delete') }}</UiButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiSurface>
    </div>

    <UserBanDialog
      :show="Boolean(banDialogUser)"
      :user="banDialogUser"
      :saving="banSaving"
      :error="banError"
      @close="closeBanDialog"
      @confirm="disableUser"
    />
  </div>
</template>
