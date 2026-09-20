import assert from 'node:assert/strict';
import { FreeplayConnection } from '../src/freeplay/connection.js';
import { FreeplayUI } from '../src/freeplay/ui.js';
import { FREEPLAY } from '../src/freeplay/config.js';

const updates=[],states=[];
const connection=new FreeplayConnection({acct:'henry',name:'Henry',token:'fixture-only-token',room:FREEPLAY.room},
  {state:value=>states.push(value),resetVote:value=>updates.push(value)},class {});
connection.epoch=1;connection.connected=true;connection.pending='approval-123';
const vote={type:'reset-vote',epoch:1,requestId:'approval-123',voters:['ahenry'],remaining:30,kind:'reset'};
connection.receive(vote);
assert.equal(connection.pending,null,'first approval must unlock normal play while waiting');
assert.equal(states.at(-1),'ready');assert.equal(updates.length,1);
connection.pending='terrain-456';connection.receive({...vote,requestId:'other-approval'});
assert.equal(connection.pending,'terrain-456','another vote cannot acknowledge a pending terrain edit');
connection.receive({...vote,epoch:0});assert.equal(updates.length,2,'stale-generation votes are ignored');
for(const change of [{voters:['ahenry','ahenry']},{remaining:31},{kind:'wipe'},{voters:[null]}])
  assert.throws(()=>connection.receive({...vote,...change}),/Invalid reset vote/);
const ui={resetButton:{}};
FreeplayUI.prototype.resetVote.call(ui,vote);assert.equal(ui.resetButton.textContent,'Reset · 1/2');
FreeplayUI.prototype.resetVote.call(ui,{...vote,kind:'restore'});assert.equal(ui.resetKind,'restore');
FreeplayUI.prototype.resetVote.call(ui,{voters:[]});assert.equal(ui.resetButton.textContent,'Full reset');
console.log('PASS free-play reset: bounded authoritative votes, pending-command isolation and visible approval state.');
