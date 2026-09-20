import { test, expect } from '@playwright/test';

test('war models: readable health, tank, turret and capture boundary',async({page},info)=>{
  await page.route('**/war-visual-fixture',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><script type="module" src="/war-visual-fixture.js"></script></body></html>'}));
  await page.route('**/war-visual-fixture.js',route=>route.fulfill({contentType:'text/javascript',body:`
    import * as THREE from '/node_modules/three/build/three.module.js';
    import { BattleRenderer } from '/src/freeplay/battle-renderer.js';
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x9bbdc9);
    scene.add(new THREE.HemisphereLight(0xffffff,0x526744,3));
    const camera=new THREE.PerspectiveCamera(50,960/600,.1,150);
    camera.position.set(11,10,18);camera.lookAt(0,1,0);
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(960,600);document.body.append(renderer.domElement);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(70,70),new THREE.MeshLambertMaterial({color:0x788958}));
    floor.rotation.x=-Math.PI/2;scene.add(floor);
    const battle=new BattleRenderer(scene,{isLoaded:()=>true,surfaceY:()=>0});
    const actor=(id,x,z,hp=50)=>({id,team:'blue',x,y:0,z,hp,yaw:0,shield:0,respawn:0,spawnSeq:1,squad:1});
    battle.apply({soldiers:[actor('one',-3,3),actor('two',-1,4,25),actor('three',1,4,10)],players:[],
      equipment:[{...actor('tank',4,0,100),kind:'tank'},{...actor('turret',-4,-1,75),kind:'turret'}],shields:[],
      ctf:{phase:'active',objective:'zone',captureRadius:3,bases:{red:[0,0,-4],blue:null},flags:{red:{x:0,y:0,z:-4,status:'home',carrier:null}}}});
    battle.update(.016,camera.position);renderer.render(scene,camera);window.warVisualReady=true;
  `}));
  await page.goto('/war-visual-fixture');
  await expect.poll(()=>page.evaluate(()=>window.warVisualReady===true)).toBe(true);
  await page.screenshot({path:info.outputPath('war-units-zones.png')});
});
