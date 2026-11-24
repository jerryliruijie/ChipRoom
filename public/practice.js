import { createRoom, apply, view } from './holdem.js';

export const scenarios = {call: '面对盲注', check: '前位过牌', allin: '短码全下'};
const me = 'south';
const small = 'west';
const big = 'east';
const format = new Intl.NumberFormat('zh-CN');

// Each example starts at one decision. All legal choices go through the live rules.
export function createPractice(scenario = 'call', version = 1) {
  const room = createRoom(me, '你');
  apply(room, small, {type:'join',name:'南枝'});
  apply(room, big, {type:'join',name:'Mika'});
  apply(room, me, {type:'settings',stack:1000,sb:10,bb:20});
  if (scenario === 'allin') room.players[0].stack = 20;
  apply(room, me, {type:'start'});
  if (scenario === 'check') {
    apply(room, me, {type:'call'});
    apply(room, small, {type:'call'});
    apply(room, big, {type:'check'});
    apply(room, small, {type:'check'});
    apply(room, big, {type:'check'});
  }
  let snapshot = {...view(room,me),practice:true,practiceDone:false,scenario,version,me};
  return {
    get state() { return snapshot; },
    play(cmd) {
      if (snapshot.practiceDone) return snapshot;
      const options = snapshot.actions;
      const own = snapshot.players.find(p => p.id === me);
      if (!options || !['fold','check','call','raise'].includes(cmd.type)) return snapshot;
      apply(room, me, cmd);
      let caption;
      if (cmd.type === 'fold') caption = '已弃牌';
      if (cmd.type === 'check') caption = '已过牌';
      if (cmd.type === 'call') caption = (own.stack === options.call ? '已全下跟注 ' : '已跟注 ') + format.format(options.call);
      if (cmd.type === 'raise') {
        const label = cmd.to === options.maxRaiseTo ? '已全下至 ' : options.wagerKind === 'bet' ? '已下注 ' : '已加注至 ';
        caption = label + format.format(cmd.to);
      }
      snapshot = {...view(room,me),practice:true,practiceDone:true,practiceCaption:caption,scenario,version:version+1,me};
      return snapshot;
    }
  };
}
