<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type Vditor from "vditor";
import type { EdgeChatVditorRuntime } from "../../vditor-runtime.ts";
import type { MentionUser } from "../../mentions.ts";
import { installVditorContentSafety } from "../../vditor-content-safety.ts";

const props = defineProps<{
	modelValue: string;
	disabled?: boolean;
	mentionCandidates?: MentionUser[];
	placeholder: string;
	runtime: EdgeChatVditorRuntime;
}>();
const emit = defineEmits<{
	"update:modelValue": [value: string];
	ready: [];
	"initialization-error": [];
	send: [];
}>();

const host = ref<HTMLElement | null>(null);
let editor: Vditor | null = null;
let initialized = false;
let alive = true;
let initializationTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let transferTarget: HTMLElement | null = null;

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function mentionHints(query: string) {
	const normalizedQuery = query.toLocaleLowerCase();
	return (props.mentionCandidates || [])
		.filter((candidate) =>
			[candidate.username, candidate.displayName].some((value) =>
				String(value || "").toLocaleLowerCase().includes(normalizedQuery),
			),
		)
			.slice(0, 8)
			.map((candidate) => ({
				html: `<strong>@${escapeHtml(candidate.username)}</strong> ${escapeHtml(candidate.displayName || "")}`,
				value: `@${candidate.username}`,
			}));
}

function syncValue() {
	if (!initialized || !editor) return props.modelValue;
	const value = editor.getValue();
	if (value !== props.modelValue) emit("update:modelValue", value);
	return value;
}

function clipboardText(data: DataTransfer | null) {
	if (!data) return "";
	const html = data.getData("text/html");
	if (!html) return data.getData("text/plain");
	// template 内容不会挂载或执行，图片可在浏览器发起请求前安全转换为可见文字。
	const template = document.createElement("template");
	template.innerHTML = html;
	for (const image of template.content.querySelectorAll("img")) {
		// 图片节点不能进入编辑区，否则浏览器会在后续净化前先请求外链；保留可读来源即可回退到 Markdown。
		image.replaceWith(document.createTextNode(image.alt || image.getAttribute("src") || ""));
	}
	return template.content.textContent || "";
}

function insertTransferredText(event: ClipboardEvent | DragEvent) {
	if (!editor) return;
	const data = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
	const text = clipboardText(data);
	event.preventDefault();
	event.stopImmediatePropagation();
	if (text) editor.insertMD(text);
	queueMicrotask(syncValue);
}

function applyDisabledState(disabled: boolean | undefined) {
	if (!initialized || !editor) return;
	if (disabled) editor.disabled();
	else editor.enable();
}

onMounted(() => {
	if (!host.value) return;
	initializationTimer = globalThis.setTimeout(() => {
		if (alive && !initialized) emit("initialization-error");
	}, 12_000);

	try {
		editor = new props.runtime.Vditor(host.value, {
			cache: { enable: false },
			cdn: props.runtime.cdn,
			height: window.matchMedia("(max-width: 600px)").matches ? 220 : 260,
			hint: {
				delay: 100,
				emoji: {},
				extend: [{ key: "@", hint: mentionHints }],
				parse: false,
			},
			i18n: props.runtime.i18n,
			icon: undefined,
			image: { isPreview: false },
			link: { isOpen: false },
			minHeight: 180,
			mode: "wysiwyg",
			placeholder: props.placeholder,
			preview: {
				mode: "editor",
				markdown: {
					codeBlockPreview: false,
					footnotes: false,
					mathBlockPreview: false,
					sanitize: true,
					toc: false,
				},
				render: { media: { enable: false } },
			},
			resize: { enable: false },
			toolbar: [
				"bold",
				"italic",
				"strike",
				"headings",
				"|",
				"list",
				"ordered-list",
				"quote",
				"inline-code",
				"code",
				"link",
				"table",
				"|",
				"undo",
				"redo",
			],
			value: "",
			after() {
				if (!editor) return;
				if (!alive) {
					editor.destroy();
					editor = null;
					return;
				}
				if (initializationTimer !== null) globalThis.clearTimeout(initializationTimer);
				installVditorContentSafety(editor.vditor.lute);
				transferTarget = editor.vditor.wysiwyg.element;
				// 必须在真实编辑节点的捕获阶段截断，才能早于 Vditor 自身的冒泡监听器处理不可信 HTML。
				transferTarget.addEventListener("paste", insertTransferredText, true);
				transferTarget.addEventListener("drop", insertTransferredText, true);
				editor.setValue(props.modelValue, true);
				initialized = true;
				applyDisabledState(props.disabled);
				syncValue();
				editor.focus();
				emit("ready");
			},
			input(value) {
				if (alive && initialized && value !== props.modelValue) {
					emit("update:modelValue", value);
				}
			},
			ctrlEnter(value) {
				if (!alive || props.disabled) return;
				if (value !== props.modelValue) emit("update:modelValue", value);
				emit("send");
			},
		});
	} catch {
		emit("initialization-error");
	}
});

watch(
	() => props.modelValue,
	(value) => {
		if (initialized && editor && value !== editor.getValue()) {
			editor.setValue(value, value.length === 0);
		}
	},
);
watch(() => props.disabled, applyDisabledState);

onBeforeUnmount(() => {
	alive = false;
	if (initializationTimer !== null) globalThis.clearTimeout(initializationTimer);
	syncValue();
	if (transferTarget) {
		transferTarget.removeEventListener("paste", insertTransferredText, true);
		transferTarget.removeEventListener("drop", insertTransferredText, true);
		transferTarget = null;
	}
	if (editor?.vditor) editor.destroy();
	editor = null;
});

defineExpose({
	focus() {
		editor?.focus();
	},
	syncValue,
});
</script>

<template>
	<div ref="host" class="composer-vditor"></div>
</template>

<style scoped>
.composer-vditor {
	width: 100%;
	min-width: 0;
}

/* 工具栏在窄屏内部横向滚动，发送与收起按钮始终留在编辑器外部。 */
/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.composer-vditor :deep(.vditor-toolbar) {
	display: flex;
	flex-wrap: nowrap;
	overflow-x: auto;
	overflow-y: hidden;
	border-radius: 6px 6px 0 0;
	-webkit-overflow-scrolling: touch;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.composer-vditor :deep(.vditor-toolbar__item) {
	flex: 0 0 auto;
}

.composer-vditor.vditor {
	border-color: #d8e0dd;
	border-radius: 7px;
	background: #ffffff;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.composer-vditor :deep(.vditor-wysiwyg) {
	overflow-x: auto;
	font-size: 15px;
}

</style>
