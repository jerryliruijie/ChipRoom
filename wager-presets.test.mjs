import test from 'node:test';
import assert from 'node:assert/strict';
import { presetAmountLabel, wagerPresets } from './public/wager-presets.js';
import { createRoom, apply, view } from './public/holdem.js';

test('shortcut captions preserve exact large units and flag rounded amounts', () => {
  assert.equal(presetAmountLabel(1_000_000_000),'10 亿');
  assert.equal(presetAmountLabel(25_000_000),'2,500 万');
  assert.equal(presetAmountLabel(999_999),'999,999');
  assert.equal(presetAmountLabel(1_000_000_001),'≈10亿');
});

function table(stacks = [100,100,100]) {
  const room = createRoom('a','A');
  for (const id of ['b','c']) apply(room,id,{type:'join',name:id});
  room.players.forEach((p,i) => { p.stack = stacks[i]; });
  apply(room,'a',{type:'start'});
  return room;
}
function checkChoices(room, expected) {
  const actor = room.turn;
  const options = wagerPresets({...view(room,actor),me:actor});
  assert.deepEqual(options.map(p=>p.to),expected);
  for (const option of options) {
    const send = () => apply(structuredClone(room),actor,{type:'raise',to:option.to});
    if (option.enabled) assert.doesNotThrow(send);
    else assert.throws(send);
  }
  return options;
}
test('facing BB: BB counts are street totals, odd halves round to the nearest chip', () => {
  const r = table();
  checkChoices(r,[10,20,30,40,50,23,35,100]);
  apply(r,'a',{type:'call'});
  // Small blind adds 5 to call. Pot then is 30; increasing by half means 25 total.
  checkChoices(r,[10,20,30,40,50,25,40,100]);
});
test('limped big blind and unopened flop use the acting player’s committed chips', () => {
  const r = table();
  apply(r,'a',{type:'call'});
  apply(r,'b',{type:'call'});
  checkChoices(r,[10,20,30,40,50,25,40,100]);
  apply(r,'c',{type:'check'});
  checkChoices(r,[10,20,30,40,50,15,30,90]);
  apply(r,'b',{type:'raise',to:15});
  // Pot is 45. Calling 15 makes 60, so full-pot raise-to = 15 + 60.
  checkChoices(r,[10,20,30,40,50,45,75,90]);
});
test('disabled presets keep their face amount; short all-in has a single legal total', () => {
  const r = table([13,100,100]);
  const choices = checkChoices(r,[10,20,30,40,50,23,35,13]);
  assert.deepEqual(choices.filter(p=>p.enabled).map(p=>p.id),['max']);
  assert.deepEqual(wagerPresets({...view(r,'b'),me:'b'}),[]);
  apply(r,'a',{type:'raise',to:13});
  apply(r,'b',{type:'raise',to:60});
  const next = checkChoices(r,[10,20,30,40,50,127,193,100]);
  assert.deepEqual(next.filter(p=>p.enabled).map(p=>p.id),['max']);
});
