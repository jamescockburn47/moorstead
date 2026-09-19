// Fictional toy weapons. Damage dimensions mirror the private server's table.
export const WEAPONS = Object.freeze([
  Object.freeze({id:'plasma',name:'Plasma blaster',colour:'#4be6ff',radius:2,depth:2,range:55,flight:.18,
    description:'A bright blue bolt that punches a small crater. Unlimited energy.'}),
  Object.freeze({id:'rocket',name:'Rocket launcher',colour:'#ff995a',radius:7,depth:5,range:75,flight:.8,
    description:'A fiery rocket with a trail of smoke and a proper crater.'}),
  Object.freeze({id:'gravity',name:'Gravity gun',colour:'#ce8aff',radius:14,depth:0,range:50,flight:.35,
    description:'A purple pulse flings nearby villagers, animals and loose debris. Everyone recovers; buildings stay intact.'}),
]);
export const weaponById=id=>WEAPONS.find(weapon=>weapon.id===id);
