import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom, apply, view} from './engine.mjs';

function table(ids = 'abc', stacks) {
  const r = createRoom('a', 'Alice');
  for (const id of ids.slice(1)) apply(r,id,{type:'join',name:id});
  if (stacks) r.players.forEach((p,i) => { p.stack = stacks[i]; });
  apply(r,'a',{type:'start'});
  return r;
}
function action(r,id,type,to) { apply(r,id,{type,to}); }
function checkRound(r) {
  const street = r.street;
  while (r.phase === 'betting' && r.street === street) {
    const a = view(r,r.turn).actions;
    action(r,r.turn,a.check ? 'check' : 'call');
  }
}
test('seats and settings guarded, BB option and check-through', () => {
  const r = createRoom('a','Alice');
  apply(r,'b',{type:'join',name:'Bob'});
  apply(r,'c',{type:'join',name:'Clara'});
  assert.throws(() => apply(r,'b',{type:'settings',stack:100,sb:1,bb:2}));
  apply(r,'c',{type:'seat',index:0});
  apply(r,'a',{type:'settings',stack:100,sb:1,bb:2});
  apply(r,'a',{type:'start'});
  assert.deepEqual([r.dealer,r.sbId,r.bbId,r.turn],['c','a','b','c']);
  assert.throws(() => action(r,'a','fold'));
  action(r,'c','call'); action(r,'a','call');
  assert.equal(view(r,'b').actions.check,true);
  action(r,'b','check');
  assert.equal(r.turn,'a');
  for (let i=0;i<3;i++) checkRound(r);
  assert.deepEqual(view(r,'a').pots,[{amount:6,eligible:['c','a','b']}]);
  apply(r,'a',{type:'award',winners:[['b','c']]});
  assert.equal(view(r,'a').pot,0);
  assert.equal(r.players.reduce((n,p) => n+p.stack,0),300);
});
test('heads up button posts SB and acts first preflop, last postflop', () => {
  const r = table('ab');
  assert.deepEqual([r.sbId,r.bbId,r.turn],['a','b','a']);
  checkRound(r); assert.equal(r.turn,'b');
  action(r,'b','raise',25); action(r,'a','fold');
  assert.deepEqual(r.players.map(p=>p.stack),[990,1010]);
  action(r,'a','start');
  assert.deepEqual([r.sbId,r.bbId,r.turn],['b','a','b']);
});
test('layered pots and uncalled chips, invalid winners leave all state intact', () => {
  const r = table('abc',[30,70,100]);
  action(r,'a','raise',30); action(r,'b','raise',70); action(r,'c','call');
  const s = view(r,'a');
  assert.equal(s.phase,'showdown');
  assert.deepEqual(s.pots,[{amount:90,eligible:['a','b','c']},{amount:80,eligible:['b','c']}]);
  const saved = JSON.stringify(r);
  assert.throws(()=>apply(r,'a',{type:'award',winners:[['a'],['a']]}));
  assert.equal(saved,JSON.stringify(r));
  apply(r,'a',{type:'award',winners:[['a'],['c']]});
  assert.deepEqual(r.players.map(p=>p.stack),[90,0,110]);
  action(r,'a','start');
  assert.equal(r.bbId,'a');
});
test('short all-in does not reopen to a prior caller; full cumulative raises do', () => {
  let r = table('abcd',[15,100,100,100]);
  action(r,'d','call'); action(r,'a','raise',15);
  action(r,'b','call'); action(r,'c','call');
  assert.equal(view(r,'d').actions.raise,false);
  assert.throws(()=>action(r,'d','raise',30));
  action(r,'d','call');
  r = table('abcd',[15,20,100,100]);
  action(r,'d','call'); action(r,'a','raise',15); action(r,'b','raise',20); action(r,'c','call');
  assert.equal(view(r,'d').actions.raise,true);
  assert.equal(view(r,'d').actions.minRaiseTo,30);
});
test('short blind with only one opponent returns unmatched excess; award odd chip left of button', () => {
  const r = table('ab',[2,100]);
  assert.equal(r.phase,'showdown');
  assert.equal(view(r,'a').pot,4);
  assert.equal(r.players[1].stack,98);
  const t = table('abc');
  action(t,'a','call'); action(t,'b','fold'); action(t,'c','check');
  for(let i=0;i<3;i++) checkRound(t);
  assert.deepEqual(view(t,'a').pots,[{amount:25,eligible:['a','c']}]);
  apply(t,'a',{type:'award',winners:[['a','c']]});
  assert.deepEqual(t.players.map(p=>p.stack),[1002,995,1003]);
});
