<script setup lang="ts">
import { computed } from "vue";
import type { GraphRow } from "@/lib/backend";

const props = defineProps<{
  graph: GraphRow;
  /** Color index per edge, parallel to `graph.edges`. */
  edgeColors: number[];
  maxLane: number;
  /** Draw spine from row top into the node (parent of a newer commit). */
  incoming?: boolean;
  rowHeight?: number;
  laneWidth?: number;
}>();

const H = computed(() => props.rowHeight ?? 22);
const W = computed(() => props.laneWidth ?? 14);
const pad = 4;

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
</script>

<template>
  <svg
    class="block shrink-0 overflow-visible"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    aria-hidden="true"
  >
    <g
      v-for="(s, i) in segments"
      :key="i"
      fill="none"
      stroke-width="1.5"
      stroke-linecap="round"
      :stroke="laneColor(s.color)"
    >
      <line
        v-if="s.kind === 'through'"
        :x1="cx(s.lane)"
        y1="0"
        :x2="cx(s.lane)"
        :y2="height"
      />
      <line
        v-else-if="s.kind === 'down'"
        :x1="cx(s.lane)"
        :y1="cy()"
        :x2="cx(s.lane)"
        :y2="height"
      />
      <path v-else :d="curvePath(s.from, s.to)" />
    </g>
    <line
      v-if="incoming"
      :x1="cx(graph.lane)"
      y1="0"
      :x2="cx(graph.lane)"
      :y2="cy()"
      fill="none"
      stroke-width="1.5"
      stroke-linecap="round"
      :stroke="laneColor(graph.color)"
    />
    <circle
      :cx="cx(graph.lane)"
      :cy="cy()"
      r="3.25"
      :fill="laneColor(graph.color)"
      class="stroke-background"
      stroke-width="1.25"
    />
  </svg>
</template>
