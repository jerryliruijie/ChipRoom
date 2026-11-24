import test from 'node:test';
import assert from 'node:assert/strict';
import {createPractice} from './public/practice.js';

test('facing blinds, a practice player has all live choices and is charged once', () => {
  const table = createPractice();
  const before = table.state;
  assert.equal(before.pot,30);
  assert.deepEqual([before.actions.fold,before.actions.call,before.actions.check,before.actions.raise],[true,20,false,true]);
  assert.throws(()=>table.play({type:'check'}));
  const after = table.play({type:'call'});
  assert.equal(after.pot,50);
  assert.equal(after.turn,'west');
  assert.equal(after.players[0].stack,980);
  assert.equal(table.play({type:'call'}),after);
  assert.equal(before.pot,30);
  assert.equal(createPractice('call',after.version+1).state.version,3);
});

test('checked-to practice offers an opening bet or check, including an all-in bet', () => {
  const free = createPractice('check');
  const before = free.state;
  assert.equal(before.street,'flop');
  assert.deepEqual([before.actions.fold,before.actions.call,before.actions.check,before.actions.wagerKind],[false,0,true,'bet']);
  assert.throws(()=>free.play({type:'fold'}));
  assert.throws(()=>free.play({type:'call'}));
  assert.equal(free.play({type:'check'}).street,'turn');
  const aggressive = createPractice('check');
  const result = aggressive.play({type:'raise',to:aggressive.state.actions.maxRaiseTo});
  assert.equal(result.allIns.at(-1).kind,'bet');
  assert.equal(result.players[0].stack,0);
});

test('short-stack practice sends a real all-in event and can be independently replayed', () => {
  const short = createPractice('allin');
  assert.equal(short.state.actions.raise,false);
  const result = short.play({type:'call'});
  assert.deepEqual(result.allIns.map(({playerId,amount,kind})=>[playerId,amount,kind]),[['south',20,'call']]);
  assert.equal(result.players[0].stack,0);
  assert.equal(result.practiceCaption,'已全下跟注 20');
  assert.equal(createPractice('allin').state.allIns.length,0);
});
