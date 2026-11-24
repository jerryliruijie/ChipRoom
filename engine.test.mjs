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

function rejectUnchanged(r, id, type, to) {
  const before = JSON.stringify(r);
  assert.throws(() => action(r, id, type, to));
  assert.equal(JSON.stringify(r), before);
}

test('BB is a live wager, limpers complete it, BB can raise, opening flop bet is distinct', () => {
  const r = table();
  const options = id => view(r,id).actions;
  assert.equal(options('b'), null);
  assert.deepEqual(options('a'), {
    fold:true, check:false, toCall:10, call:10, wagerKind:'raise', raise:true, minRaiseTo:20, maxRaiseTo:1000
  });
  rejectUnchanged(r,'a','check');
  rejectUnchanged(r,'a','raise',19);
  action(r,'a','call');
  assert.equal(options('b').call,5);
  action(r,'b','call');
  assert.deepEqual([options('c').check,options('c').fold,options('c').wagerKind],[true,false,'raise']);
  rejectUnchanged(r,'c','fold');
  action(r,'c','raise',25);
  assert.equal(options('a').minRaiseTo,40);
  action(r,'a','call');
  action(r,'b','call');
  assert.equal(r.street,'flop');
  assert.deepEqual([options('b').toCall,options('b').wagerKind,options('b').minRaiseTo],[0,'bet',10]);
  action(r,'b','check');
  action(r,'c','raise',10);
  assert.ok(r.log.at(-1).includes('下注 10'));
  action(r,'a','call');
  assert.deepEqual([options('b').raise,options('b').minRaiseTo],[true,20]);
  action(r,'b','raise',20);
  checkRound(r);
  assert.deepEqual([r.street,r.turn,options('b').wagerKind],['turn','b','bet']);
});

test('short preflop blind and short opening all-in use different bring-in amounts', () => {
  const pre = table('abc',[100,100,6]);
  assert.deepEqual([view(pre,'a').actions.call,view(pre,'a').actions.minRaiseTo],[10,20]);
  action(pre,'a','fold');
  const last = view(pre,'b').actions;
  assert.deepEqual([last.call,last.raise],[1,false]);
  action(pre,'b','call');
  assert.equal(view(pre,'a').pot,12);

  const flop = table('abc',[100,100,16]);
  checkRound(flop);
  action(flop,'b','check');
  action(flop,'c','raise',6);
  assert.deepEqual(view(flop,'a').allIns.at(-1), {id:'1:1',playerId:'c',kind:'bet',amount:6});
  const unacted = view(flop,'a').actions;
  assert.deepEqual([unacted.call,unacted.raise,unacted.minRaiseTo],[6,true,16]);
  rejectUnchanged(flop,'a','raise',15);
  action(flop,'a','call');
  const checked = view(flop,'b').actions;
  assert.deepEqual([checked.call,checked.raise],[6,false]);
  rejectUnchanged(flop,'b','raise',16);
  action(flop,'b','call');
  assert.equal(flop.street,'turn');
});

test('cumulative reopening is relative to each player’s most recent action', () => {
  const r = table('abcde',[15,100,20,100,100]);
  action(r,'d','call');
  action(r,'e','call');
  action(r,'a','raise',15);
  action(r,'b','call');
  action(r,'c','raise',20);
  assert.equal(view(r,'d').actions.raise,true);
  action(r,'d','call');
  assert.equal(view(r,'e').actions.raise,true);
  action(r,'e','call');
  assert.deepEqual([view(r,'b').actions.call,view(r,'b').actions.raise],[5,false]);
});

test('all-in events survive same-action refund, settlement and legacy room reads', () => {
  const r = table('ab',[100,23]);
  delete r.allIns;
  assert.deepEqual(view(r,'a').allIns,[]);
  action(r,'a','raise',100);
  const small = view(r,'b').actions;
  assert.deepEqual([small.toCall,small.call,small.raise],[90,13,false]);
  action(r,'b','call');
  assert.deepEqual(view(r,'a').allIns,[
    {id:'1:1',playerId:'a',kind:'raise',amount:95},
    {id:'1:2',playerId:'b',kind:'call',amount:13}
  ]);
  assert.equal(view(r,'a').pot,46);
  assert.equal(r.players[0].stack,77);
  apply(r,'a',{type:'award',winners:[['b']]});
  assert.equal(view(r,'a').allIns.length,2);
  action(r,'a','start');
  assert.deepEqual(view(r,'b').allIns,[]);
  const blinds = table('ab',[5,7]);
  assert.deepEqual(view(blinds,'a').allIns,[
    {id:'1:1',playerId:'a',kind:'sb',amount:5},
    {id:'1:2',playerId:'b',kind:'bb',amount:7}
  ]);
  assert.equal(view(blinds,'a').pot,10);
  assert.equal(blinds.players[1].stack,2);
});

test('busted BB leaves a dead small blind; the following hand advances its dead button', () => {
  const r = table('abcd',[100,100,10,100]);
  action(r,'d','call');
  action(r,'a','call');
  action(r,'b','call');
  while (r.phase==='betting') checkRound(r);
  apply(r,'a',{type:'award',winners:[['a']]});
  action(r,'a','start');
  assert.deepEqual([r.dealer,r.sbId,r.bbId,r.turn],['b',null,'d','a']);
  assert.equal(view(r,'a').pot,10);
  action(r,'a','fold');
  action(r,'b','fold');
  action(r,'a','start');
  assert.deepEqual([r.dealer,r.sbId,r.bbId,r.turn],['c','d','a','b']);
  checkRound(r);
  assert.equal(r.turn,'d');
});

test('seeded multi-hand games preserve chips, pot eligibility, action boundaries and progress', () => {
  let seed = 24817;
  const random = () => ((seed = (Math.imul(seed,1664525) + 1013904223) >>> 0) / 2**32);
  for (let round = 0; round < 100; round++) {
    const seats = 2 + Math.floor(random()*9);
    const ids = 'abcdefghij'.slice(0,seats);
    const stacks = [...ids].map(() => 1 + Math.floor(random()*150));
    const initial = stacks.reduce((a,b) => a+b,0);
    const r = table(ids,stacks);
    for (let hand=1; hand<=15; hand++) {
      for (let count=0; r.phase==='betting'; count++) {
        assert.ok(count<200);
        const a = view(r,r.turn).actions;
        assert.equal(a.fold,a.call>0);
        assert.equal(a.check,!a.fold);
        const chance = random();
        if (chance<0.2 && a.fold) action(r,r.turn,'fold');
        else if (chance<0.48 && a.raise) {
          const to = a.minRaiseTo + Math.floor(random()*(a.maxRaiseTo-a.minRaiseTo+1));
          action(r,r.turn,'raise',to);
        } else action(r,r.turn,a.check?'check':'call');
        assert.equal(r.players.reduce((n,p) => n+p.stack+p.total,0),initial);
        assert.ok(r.players.every(p => p.stack>=0 && p.total>=p.bet && p.bet>=0));
      }
      if (r.phase==='showdown') {
        const v = view(r,'a');
        assert.equal(v.pots.reduce((n,p) => n+p.amount,0),v.pot);
        const ranks = new Map(r.players.map(p => [p.id, Math.floor(random()*8)]));
        const winners = v.pots.map(pot => {
          assert.ok(pot.eligible.length);
          const high = Math.max(...pot.eligible.map(id => ranks.get(id)));
          return pot.eligible.filter(id => ranks.get(id)===high);
        });
        apply(r,'a',{type:'award',winners});
      }
      assert.equal(r.phase,'complete');
      assert.equal(r.players.reduce((n,p) => n+p.stack,0),initial);
      if (r.players.filter(p => p.stack>0).length<2 || hand===15) break;
      action(r,'a','start');
    }
  }
});
