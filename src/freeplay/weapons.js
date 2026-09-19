// Fictional toy weapons. Damage dimensions mirror the private server's table.
export const WEAPONS = Object.freeze([
  Object.freeze({id:'plasma',name:'Plasma blaster',colour:'#4be6ff',radius:2,depth:2,range:55,flight:.18,
    description:'A bright blue bolt that punches a small crater. Unlimited energy.'}),
  Object.freeze({id:'rocket',name:'Rocket launcher',colour:'#ff995a',radius:7,depth:5,range:75,flight:.8,
    description:'A fiery rocket with a trail of smoke and a proper crater.'}),
  Object.freeze({id:'gravity',name:'Gravity gun',colour:'#ce8aff',radius:14,depth:0,range:50,flight:.35,
    description:'A purple pulse flings nearby villagers, animals and loose debris. Everyone recovers; buildings stay intact.'}),
  Object.freeze({id:'machinegun',name:'Machine gun',colour:'#ffd16b',radius:1,depth:1,range:55,flight:.08,automatic:true,cooldown:.25,
    description:'Hold Fire for a rattling stream of bright tracers and small chips in the landscape.'}),
  Object.freeze({id:'sheep',name:'Sheep launcher',colour:'#b7f4d1',radius:0,depth:0,range:48,flight:0,cooldown:.7,
    description:'Launch a live sheep with a cheerful baa. It lands safely and ambles around for a little while.'}),
]);
export const weaponById=id=>WEAPONS.find(weapon=>weapon.id===id);
