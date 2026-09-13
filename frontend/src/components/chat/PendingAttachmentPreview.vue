<script setup>
import { Mic } from '@lucide/vue';
import { computed } from 'vue';
import api from '../../api.js';
import UiBadge from '../ui/Badge.vue';
import UiButton from '../ui/Button.vue';
import { isPreviewableImageAttachment } from './attachment-utils.js';
import { t } from '../../i18n.js';
import { formatVoiceDuration } from '../../voice-message.js';

const props = defineProps({
  attachment: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['clear']);
const isImage = computed(() => isPreviewableImageAttachment(props.attachment));
const displayName = computed(() => props.attachment?.name || t('attachments.fallback'));
const attachmentUrl = computed(() => api.getFileUrl(props.attachment?.key || props.attachment?.url));
const isVoice = computed(() => props.attachment?.kind === 'voice');
</script>

<template>
  <div class="pending-attachment" :class="{ 'pending-attachment--image': isImage }">
	    <img
	      v-if="isImage && !isVoice"
      class="pending-attachment__thumb"
      :src="attachmentUrl"
      :alt="displayName"
      loading="lazy"
	    />
	    <span v-else-if="isVoice" class="pending-attachment__voice">
	      <Mic :size="18" aria-hidden="true" />
	      {{ formatVoiceDuration(attachment.durationMs) }}
	    </span>
    <UiBadge class="pending-attachment__name" variant="secondary">{{ displayName }}</UiBadge>
    <UiButton class="pending-attachment__clear" variant="ghost" size="sm" @click="emit('clear')">{{ t('common.remove') }}</UiButton>
  </div>
</template>
