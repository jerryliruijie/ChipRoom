import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, apply, view } from './engine.mjs';
import { openPractice, practiceCall } from './public/practice.js';

test('the repeatable call matches a three-player room and charges once', () => {
  const initial = openPractice();
  const room = createRoom(initial.me, '你');
  for (const {id, name} of initial.players.slice(1)) apply(room, id, {type: 'join', name});
  apply(room, initial.me, {type: 'settings', ...initial.settings});
  apply(room, initial.me, {type: 'start'});
  const amounts = state => state.players.map(({stack, bet, total}) => [stack, bet, total]);
  const before = view(room, initial.me);
  assert.equal(initial.actions.call, before.actions.call);
  assert.deepEqual(amounts(initial), amounts(before));
  apply(room, initial.me, {type: 'call'});
  const after = view(room, initial.me);
  const result = practiceCall(initial);
  assert.deepEqual(amounts(result), amounts(after));
  assert.equal(result.turn, after.turn);
  assert.equal(result.pot, after.pot);
  assert.equal(practiceCall(result), result);
  assert.equal(initial.pot, 30);
  assert.deepEqual(amounts(openPractice(result.version + 1)), amounts(before));
});
