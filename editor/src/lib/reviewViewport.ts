export type ReviewViewport = { scale: number; x: number; y: number };
export const REVIEW_FIT: ReviewViewport = { scale: 1, x: 0, y: 0 };

/** Pointer coordinates and translation are CSS pixels relative to the pane center. */
export function zoomReviewAt(view: ReviewViewport, requestedScale: number, point: { x: number; y: number }): ReviewViewport {
  const scale = Math.max(0.25, Math.min(8, requestedScale));
  const ratio = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}

export function adjacentCandidate(index: number, direction: number, count: number): number {
  return count > 0 ? ((index + direction) % count + count) % count : 0;
}
