<script setup lang="ts">
import { computed } from "vue";
import {
  Braces,
  Coffee,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  Settings2,
} from "@lucide/vue";

const props = withDefaults(
  defineProps<{
    name: string;
    kind?: "file" | "folder";
    expanded?: boolean;
    class?: string;
  }>(),
  { kind: "file", expanded: false },
);

const icon = computed(() => {
  if (props.kind === "folder") return props.expanded ? FolderOpen : Folder;
  const base = props.name.replace(/\\/g, "/").split("/").pop() ?? props.name;
  const lower = base.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"].includes(ext)) return FileImage;
  if (["json", "jsonc", "json5"].includes(ext)) return FileJson;
  if (["xml", "xsl", "xsd", "html", "htm", "xhtml"].includes(ext)) return FileCode2;
  if (["yml", "yaml", "toml", "ini", "cfg", "conf", "properties", "env"].includes(ext))
    return Settings2;
  if (["md", "txt", "rst", "log", "csv"].includes(ext)) return FileText;
  if (["java", "class", "jar"].includes(ext)) return Coffee;
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"].includes(ext)) return Braces;
  if (
    ["rs", "go", "py", "rb", "php", "c", "cc", "cpp", "h", "hpp", "cs", "kt", "swift", "scala"].includes(
      ext,
    )
  )
    return FileCode2;
  if (["css", "scss", "sass", "less"].includes(ext)) return FileType2;
  if (!ext && lower.startsWith(".")) return Settings2;
  return File;
});

const tone = computed(() => {
  if (props.kind === "folder") return "text-amber-700/80 dark:text-amber-400/80";
  const base = props.name.replace(/\\/g, "/").split("/").pop() ?? props.name;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  if (["java", "class", "jar"].includes(ext)) return "text-orange-700/90 dark:text-orange-400/90";
  if (["ts", "tsx"].includes(ext)) return "text-sky-700/90 dark:text-sky-400/90";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "text-yellow-700/90 dark:text-yellow-400/80";
  if (["xml", "html", "htm"].includes(ext)) return "text-emerald-700/90 dark:text-emerald-400/80";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext))
    return "text-fuchsia-700/80 dark:text-fuchsia-400/80";
  if (["json", "yml", "yaml", "properties", "toml"].includes(ext))
    return "text-lime-800/80 dark:text-lime-400/80";
  return "text-muted-foreground";
});
</script>

<template>
  <component
    :is="icon"
    :class="['h-3.5 w-3.5 shrink-0', tone, props.class]"
    aria-hidden="true"
  />
</template>
