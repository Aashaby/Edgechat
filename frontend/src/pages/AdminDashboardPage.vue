<script setup>
import {
  Activity,
  ArrowRight,
  Globe2,
  Home,
  Link,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Settings,
  UserCog,
  UserPlus,
  Users
} from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api.js';
import { formatTime, t } from '../i18n.js';

const router = useRouter();
const loading = ref(false);
const error = ref('');
const refreshedAt = ref(null);
const overview = ref({ site: null, users: [], channels: [], dms: [] });

const activeUserCount = computed(
  () => overview.value.users.filter((user) => !user.isDisabled).length
);
const publicChannelCount = computed(
  () => overview.value.channels.filter((channel) => channel.kind === 'public').length
);
const privateChannelCount = computed(
  () => overview.value.channels.filter((channel) => channel.kind === 'private').length
);
const totalMessageCount = computed(() => {
  const channelMessages = overview.value.channels.reduce(
    (total, channel) => total + Number(channel.messageCount || 0),
    0
  );
  const dmMessages = overview.value.dms.reduce(
    (total, dm) => total + Number(dm.messageCount || 0),
    0
  );
  return channelMessages + dmMessages;
});

const metrics = computed(() => [
  { label: t('dashboard.metrics.users'), value: overview.value.users.length, icon: Users },
  { label: t('dashboard.metrics.groups'), value: overview.value.channels.length, icon: MessagesSquare },
  { label: t('dashboard.metrics.directMessages'), value: overview.value.dms.length, icon: MessageSquare },
  { label: t('dashboard.metrics.messages'), value: totalMessageCount.value, icon: Activity }
]);

const quickLinks = computed(() => [
  { label: t('admin.nav.users'), to: '/admin/users', icon: UserCog },
  { label: t('admin.nav.createUser'), to: '/admin/invites#create-user', icon: UserPlus },
  { label: t('admin.nav.registrationLinks'), to: '/admin/invites#registration-links', icon: Link },
  { label: t('admin.nav.site'), to: '/admin/site#site-appearance', icon: Settings },
  { label: t('nav.backToChat'), to: '/', icon: Home }
]);

const refreshedTime = computed(() => {
  if (!refreshedAt.value) {
    return t('dashboard.notRefreshed');
  }
  return formatTime(refreshedAt.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
});

async function loadOverview() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminOverview();
    overview.value = {
      site: payload.site || null,
      users: payload.users || [],
      channels: payload.channels || [],
      dms: payload.dms || []
    };
    refreshedAt.value = new Date();
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

function navigate(path) {
  void router.push(path);
}

onMounted(loadOverview);
</script>

<template>
  <div class="admin-dashboard">
    <section class="admin-dashboard__metrics" :aria-label="t('dashboard.metrics.ariaLabel')">
      <article v-for="metric in metrics" :key="metric.label" class="admin-dashboard-metric">
        <span class="admin-icon-tile admin-icon-tile--neutral">
          <component :is="metric.icon" :size="21" aria-hidden="true" />
        </span>
        <div>
          <span>{{ metric.label }}</span>
          <strong>{{ loading ? '—' : metric.value }}</strong>
        </div>
      </article>
    </section>

    <section class="admin-dashboard__body">
      <article class="admin-panel admin-quick-panel">
        <header class="admin-panel__header">
          <h2>{{ t('dashboard.quickAccess') }}</h2>
        </header>
        <div class="admin-quick-grid">
          <button
            v-for="link in quickLinks"
            :key="`${link.to}-${link.label}`"
            type="button"
            class="admin-quick-link"
            @click="navigate(link.to)"
          >
            <span class="admin-icon-tile">
              <component :is="link.icon" :size="21" aria-hidden="true" />
            </span>
            <span class="admin-quick-link__copy">
              <strong>{{ link.label }}</strong>
            </span>
            <ArrowRight :size="17" aria-hidden="true" />
          </button>
        </div>
      </article>

      <article class="admin-panel admin-status-panel">
        <header class="admin-panel__header admin-panel__header--actions">
          <div>
            <h2>{{ t('dashboard.systemOverview') }}</h2>
            <p>{{ t('dashboard.lastRefreshed', { time: refreshedTime }) }}</p>
          </div>
          <button
            type="button"
            class="admin-icon-button"
            :disabled="loading"
            :title="t('dashboard.refreshData')"
            :aria-label="t('dashboard.refreshData')"
            @click="loadOverview"
          >
            <RefreshCw :size="18" aria-hidden="true" :class="{ 'admin-spin': loading }" />
          </button>
        </header>

        <div v-if="error" class="admin-dashboard-state admin-dashboard-state--error">
          <Activity :size="28" aria-hidden="true" />
          <strong>{{ t('dashboard.loadFailed') }}</strong>
          <span>{{ error }}</span>
          <button type="button" class="admin-secondary-command" @click="loadOverview">{{ t('common.reload') }}</button>
        </div>

        <div v-else class="admin-status-list">
          <div class="admin-status-list__item">
            <span class="admin-icon-tile"><Globe2 :size="20" aria-hidden="true" /></span>
            <div>
              <span>{{ t('dashboard.site') }}</span>
              <strong>{{ overview.site?.siteName || 'Edgechat' }}</strong>
            </div>
          </div>
          <div class="admin-status-list__item">
            <span class="admin-icon-tile"><Users :size="20" aria-hidden="true" /></span>
            <div>
              <span>{{ t('dashboard.availableAccounts') }}</span>
              <strong>{{ loading ? t('common.loading') : `${activeUserCount} / ${overview.users.length}` }}</strong>
            </div>
          </div>
          <div class="admin-status-list__item">
            <span class="admin-icon-tile"><MessagesSquare :size="20" aria-hidden="true" /></span>
            <div>
              <span>{{ t('dashboard.groupDistribution') }}</span>
              <strong>{{ loading ? t('common.loading') : t('dashboard.channelBreakdown', { publicCount: publicChannelCount, privateCount: privateChannelCount }) }}</strong>
            </div>
          </div>
          <div class="admin-status-list__item">
            <span class="admin-icon-tile"><MessageSquare :size="20" aria-hidden="true" /></span>
            <div>
              <span>{{ t('dashboard.totalMessages') }}</span>
              <strong>{{ loading ? t('common.loading') : totalMessageCount }}</strong>
            </div>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped src="../styles/admin/dashboard.css"></style>
