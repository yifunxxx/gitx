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
  /** Visible horizontal interval in this SVG's original coordinate space. */
  viewportLeft?: number;
  viewportWidth?: number;
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

type Seg = { key: number } & (
  | { kind: "through"; lane: number; color: number }
  | { kind: "down"; lane: number; color: number }
  | { kind: "curve"; from: number; to: number; color: number }
);

const segments = computed(() => {
  const segs: Seg[] = [];
  const node = props.graph.lane;
  const seenThrough = new Set<number>();

  props.graph.edges.forEach((e, i) => {
    const color = props.edgeColors[i] ?? props.graph.color;
    if (e.fromLane === e.toLane) {
      if (e.fromLane === node) {
        segs.push({ key: i, kind: "down", lane: e.fromLane, color });
      } else if (!seenThrough.has(e.fromLane)) {
        seenThrough.add(e.fromLane);
        segs.push({ key: i, kind: "through", lane: e.fromLane, color });
      }
    } else {
      segs.push({ key: i, kind: "curve", from: e.fromLane, to: e.toLane, color });
    }
  });
  return segs;
});

const visibleSegments = computed(() => {
  const left = props.viewportLeft;
  const viewportWidth = props.viewportWidth;
  if (
    left === undefined ||
    viewportWidth === undefined ||
    !Number.isFinite(left) ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0
  )
    return segments.value;
  // Include the 2px stroke, round caps and a conservative antialiasing margin.
  const minimum = left - 2;
  const maximum = left + viewportWidth + 2;
  return segments.value.filter((segment) => {
    const x1 = cx(segment.kind === "curve" ? segment.from : segment.lane);
    const x2 = cx(segment.kind === "curve" ? segment.to : segment.lane);
    // curvePath's control points use only x1 and x2. Its x range is bounded by
    // those endpoints; a curve crossing the viewport must remain even when
    // both endpoints lie outside it. Keep each original key while panning.
    return Math.max(x1, x2) >= minimum && Math.min(x1, x2) <= maximum;
  });
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
        v-for="s in visibleSegments"
        :key="s.key"
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
