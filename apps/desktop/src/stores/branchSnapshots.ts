import type { RefEntry, RefsList, RemoteInfo } from "@/lib/backend";

function sameArray<T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
  same: (a: T, b: T) => boolean,
) {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.length === right.length &&
      left.every((item, index) => same(item, right[index]!)))
  );
}

function sameRef(left: RefEntry, right: RefEntry) {
  return (
    left === right ||
    (left.name === right.name &&
      left.fullName === right.fullName &&
      left.kind === right.kind &&
      left.sha === right.sha &&
      left.upstream === right.upstream &&
      left.ahead === right.ahead &&
      left.behind === right.behind &&
      left.isHead === right.isHead &&
      left.subject === right.subject &&
      left.committerTime === right.committerTime &&
      left.peeledSha === right.peeledSha &&
      left.isFavorite === right.isFavorite)
  );
}

/** Equal IPC snapshots should not invalidate filtering and both branch trees. */
export function sameRefsList(left: RefsList | null, right: RefsList) {
  return (
    left === right ||
    (!!left &&
      left.current === right.current &&
      left.detached === right.detached &&
      sameArray(left.recent, right.recent, (a, b) => a === b) &&
      sameArray(left.local, right.local, sameRef) &&
      sameArray(left.remote, right.remote, sameRef) &&
      sameArray(left.tags, right.tags, sameRef))
  );
}

export function sameRemotes(left: RemoteInfo[], right: RemoteInfo[]) {
  return sameArray(
    left,
    right,
    (a, b) => a.name === b.name && a.fetchUrl === b.fetchUrl && a.pushUrl === b.pushUrl,
  );
}
