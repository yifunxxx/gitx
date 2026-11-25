import { shallowRef } from "vue";
import { workspacePathKey } from "@/lib/workspacePath";

export const FILE_DRAG_TYPE = "application/x-gitx-project-files";
export type FileDrag = {
  folder: string;
  navigation: number;
  applied: number | null;
  paths: string[];
};
// Only drags initiated in this window are accepted. External DataTransfer text
// must never authorize workspace mutations.
export const activeFileDrag = shallowRef<FileDrag | null>(null);
export function startFileDrag(event: DragEvent, source: FileDrag) {
  if (!event.dataTransfer) return;
  activeFileDrag.value = source;
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(FILE_DRAG_TYPE, "files");
}
export function endFileDrag() {
  activeFileDrag.value = null;
}
export function currentFileDrag(folder: string | null, navigation: number, applied: number | null) {
  const source = activeFileDrag.value;
  return source &&
    source.folder === folder &&
    source.navigation === navigation &&
    source.applied === applied
    ? source
    : null;
}
export function validFileDrop(paths: string[], directory: string, copy: boolean, folder: string) {
  const key = (path: string) => workspacePathKey(`${folder}/${path}`);
  const target = key(directory);
  return (
    paths.length > 0 &&
    paths.every((path) => {
      const source = key(path);
      if (target === source || target.startsWith(`${source}/`)) return false;
      const parent = path.split("/").slice(0, -1).join("/");
      return copy || key(parent) !== target;
    })
  );
}
