<script setup lang="ts">
import { computed } from "vue";
import type { GraphRow } from "@/lib/backend";
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const props = defineProps<{
  graph: GraphRow;
  /** Color index per edge, parallel to `graph.edges`. */
  edgeColors: number[];
  maxLane: number;
  /** Draw spine from row top into the node (parent of a newer commit). */
  incoming?: boolean;
  rowHeight?: number;
  laneWidth?: number;
  /** Human labels for each lane (branch / tag / short sha). */
  laneLabels?: Record<number, string>;
  /** Label for this commit's node (refs on the commit). */
  nodeLabel?: string;
  hiddenParents?: string[];
}>();

const H = computed(() => props.rowHeight ?? 22);
const W = computed(() => props.laneWidth ?? 16);
const pad = 6;

const width = computed(() => Math.max(1, props.maxLane + 1) * W.value + pad * 2);
const height = computed(() => H.value);

function cx(lane: number) {
  return pad + lane * W.value + W.value / 2;
}

function cy() {
  return H.value / 2;
}

function laneColor(color: number) {
  return `rgb(var(--graph-lane-${color % 12}))`;
}

function tipForLane(lane: number) {
  return props.laneLabels?.[lane] ?? "";
}

type Seg =
  | { kind: "through"; lane: number; color: number }
  | { kind: "down"; lane: number; color: number }
  | { kind: "curve"; from: number; to: number; color: number };

const segments = computed(() => {
  const segs: Seg[] = [];
  const node = props.graph.lane;
  const seenThrough = new Set<number>();

  props.graph.edges.forEach((e, i) => {
    const color = props.edgeColors[i] ?? props.graph.color;
    if (e.fromLane === e.toLane) {
      if (e.fromLane === node) {
        segs.push({ kind: "down", lane: e.fromLane, color });
      } else if (!seenThrough.has(e.fromLane)) {
        seenThrough.add(e.fromLane);
        segs.push({ kind: "through", lane: e.fromLane, color });
      }
    } else {
      segs.push({ kind: "curve", from: e.fromLane, to: e.toLane, color });
    }
  });
  return segs;
});

function curvePath(from: number, to: number) {
  const x1 = cx(from);
  const y1 = cy();
  const x2 = cx(to);
  const y2 = H.value;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

const tip = computed(() => props.nodeLabel || tipForLane(props.graph.lane) || "");
</script>

<template>
  <!-- Single SVG per recycled row; no duplicate transparent hit strokes (halves node count). -->
  <svg
    class="block shrink-0 overflow-hidden [contain:strict]"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    role="img"
    :aria-label="tip || undefined"
  >
    <title v-if="tip">{{ tip }}</title>
    <g fill="none" stroke-width="2" stroke-linecap="round">
      <path
        v-for="(s, i) in segments"
        :key="i"
        :stroke="laneColor(s.color)"
        :d="
          s.kind === 'curve'
            ? curvePath(s.from, s.to)
            : s.kind === 'down'
              ? `M ${cx(s.lane)} ${cy()} L ${cx(s.lane)} ${height}`
              : `M ${cx(s.lane)} 0 L ${cx(s.lane)} ${height}`
        "
      />
      <path
        v-if="incoming"
        :stroke="laneColor(graph.color)"
        :d="`M ${cx(graph.lane)} 0 L ${cx(graph.lane)} ${cy()}`"
      />
      <path
        v-if="hiddenParents?.length"
        :stroke="laneColor(graph.color)"
        stroke-dasharray="2 2"
        :d="`M ${cx(graph.lane)} ${cy() + 4} L ${cx(graph.lane)} ${height - 3}`"
      >
        <title>
          {{
            t("log.hiddenParents", {
              parents: hiddenParents.map((sha) => sha.slice(0, 7)).join(", "),
            })
          }}
        </title>
      </path>
    </g>
    <circle
      :cx="cx(graph.lane)"
      :cy="cy()"
      r="3.5"
      :fill="laneColor(graph.color)"
      class="stroke-background"
      stroke-width="1.5"
    />
  </svg>
</template>
