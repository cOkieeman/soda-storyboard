import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacentCandidate, zoomReviewAt } from '../src/lib/reviewViewport.ts';

test('review zoom keeps the image point under the pointer fixed', () => {
  const view = { scale: 1.5, x: 40, y: -15 }, pointer = { x: 170, y: 60 };
  const imagePoint = { x: (pointer.x - view.x) / view.scale, y: (pointer.y - view.y) / view.scale };
  const next = zoomReviewAt(view, 3, pointer);
  assert.equal(imagePoint.x * next.scale + next.x, pointer.x);
  assert.equal(imagePoint.y * next.scale + next.y, pointer.y);
});

test('review zoom limits extreme requests without invalidating the anchor', () => {
  const view = { scale: 1, x: 0, y: 0 };
  assert.equal(zoomReviewAt(view, 100, { x: 0, y: 0 }).scale, 8);
  assert.equal(zoomReviewAt(view, 0.01, { x: 0, y: 0 }).scale, 0.25);
  assert.equal(adjacentCandidate(0, -1, 3), 2);
  assert.equal(adjacentCandidate(2, 1, 3), 0);
});
