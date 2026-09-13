<script setup>
import { computed } from 'vue';
import { useI18n } from '../../i18n.js';

const { isEnglish, t, toggleLocale } = useI18n();
const actionLabel = computed(() =>
  isEnglish.value ? t('language.switchToChinese') : t('language.switchToEnglish')
);
</script>

<template>
  <button
    type="button"
    class="language-switch"
    :title="actionLabel"
    :aria-label="actionLabel"
    :data-tooltip="actionLabel"
    @click="toggleLocale"
  >
    <span class="language-switch__glyph" aria-hidden="true">
      <span class="language-switch__han">文</span>
      <span class="language-switch__en">EN</span>
    </span>
  </button>
</template>

<style scoped>
.language-switch {
  width: 44px;
  min-width: 44px;
  height: 44px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(88, 107, 124, 0.22);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  color: currentColor;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
  cursor: pointer;
  touch-action: manipulation;
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
}

.language-switch:hover {
  border-color: rgba(45, 156, 151, 0.42);
  background: rgba(255, 255, 255, 0.94);
}

.language-switch:active {
  transform: scale(0.96);
}

.language-switch:focus-visible {
  outline: 2px solid rgba(45, 156, 151, 0.62);
  outline-offset: 2px;
}

.language-switch__glyph {
  position: relative;
  width: 29px;
  height: 24px;
  display: block;
}

.language-switch__glyph::after {
  content: '';
  position: absolute;
  left: 13px;
  top: 11px;
  width: 14px;
  height: 1px;
  background: currentColor;
  opacity: 0.38;
  transform: rotate(-38deg);
  transform-origin: center;
}

.language-switch__han,
.language-switch__en {
  position: absolute;
  line-height: 1;
  letter-spacing: 0;
}

.language-switch__han {
  left: 0;
  top: 0;
  font-size: 16px;
  font-weight: 750;
}

.language-switch__en {
  right: 0;
  bottom: 0;
  font-size: 9px;
  font-weight: 800;
}

@media (prefers-reduced-motion: reduce) {
  .language-switch {
    transition: none;
  }
}
</style>
