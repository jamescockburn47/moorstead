// Shared, scene-owned procedural kit. Static boxes batch by material per place.
import * as THREE from 'three';

export const V3_PALETTE = { iron: 0x263c38, cream: 0xf0dfb4, red: 0x803b32, slate: 0x394f60, oak: 0x765238, brass: 0xc49b51, paper: 0xe9d5a3 };

export class V3PropKit {
  constructor() {
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.plane = new THREE.PlaneGeometry(1, 1);
    this.materials = new Map(); this.labels = new Map(); this.owned = [];
  }
  material(colour, glow = false) {
    const key = `${colour}:${glow}`;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshLambertMaterial({ color: colour, emissive: glow ? colour : 0, emissiveIntensity: glow ? 0.65 : 0 }));
    return this.materials.get(key);
  }
  box(root, size, pos, colour, rotation = 0, glow = false) {
    const m = new THREE.Mesh(this.geometry, this.material(colour, glow));
    m.scale.set(...size); m.position.set(...pos); m.rotation.z = rotation; root.add(m); return m;
  }
  label(root, text, pos, width, height = 0.42, colour = '#f0dfb4') {
    const key = text + colour;
    let material = this.labels.get(key);
    if (!material) {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#263c38'; ctx.fillRect(0, 0, 1024, 160);
      ctx.strokeStyle = colour; ctx.lineWidth = 5; ctx.strokeRect(10, 10, 1004, 140);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = colour;
      let size = 76; ctx.font = `bold ${size}px Georgia, serif`;
      while (ctx.measureText(text).width > 940 && size > 24) ctx.font = `bold ${--size}px Georgia, serif`;
      ctx.fillText(text, 512, 84);
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
      this.labels.set(key, material); this.owned.push(texture);
    }
    const m = new THREE.Mesh(this.plane, material); m.position.set(...pos); m.scale.set(width, height, 1); root.add(m); return m;
  }
  lantern(root, x, y, z) {
    const c = V3_PALETTE;
    this.box(root, [.28, .42, .28], [x, y, z], 0xffc36a, 0, true);
    for (const dx of [-.17, .17]) for (const dz of [-.17, .17]) this.box(root, [.045, .5, .045], [x + dx, y, z + dz], c.iron);
    this.box(root, [.43, .09, .43], [x, y + .28, z], c.iron);
    this.box(root, [.38, .07, .38], [x, y - .27, z], c.iron);
    this.box(root, [.05, .32, .05], [x, y + .45, z], c.iron);
  }
  clock(root, pos) {
    const g = new THREE.Group(); g.position.set(...pos); root.add(g);
    this.box(g, [.92, .92, .12], [0, 0, 0], V3_PALETTE.brass);
    this.box(g, [.8, .8, .04], [0, 0, .08], V3_PALETTE.cream);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      this.box(g, [.025, .07, .015], [Math.sin(a) * .32, Math.cos(a) * .32, .11], V3_PALETTE.iron, -a);
    }
    const hands = [new THREE.Group(), new THREE.Group()];
    for (let i = 0; i < 2; i++) {
      g.add(hands[i]); this.box(hands[i], [i ? .025 : .04, i ? .29 : .21, .025], [0, i ? .12 : .08, .14 + i * .03], V3_PALETTE.iron);
    }
    g.userData.clockHands = hands; return g;
  }
  batch(root) {
    // Only direct static boxes: dynamic clock hands and labels retain ownership.
    const groups = new Map();
    for (const m of [...root.children]) if (m.isMesh && m.geometry === this.geometry) {
      m.updateMatrix(); if (!groups.has(m.material)) groups.set(m.material, []);
      groups.get(m.material).push(m.matrix.clone()); root.remove(m);
    }
    for (const [mat, matrices] of groups) {
      const batch = new THREE.InstancedMesh(this.geometry, mat, matrices.length);
      matrices.forEach((matrix, i) => batch.setMatrixAt(i, matrix));
      batch.computeBoundingSphere(); root.add(batch);
    }
    for (const child of root.children) if (child.isGroup) this.batch(child);
  }
  dispose() {
    this.geometry.dispose(); this.plane.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.labels.values()) m.dispose();
    for (const t of this.owned) t.dispose();
    this.materials.clear(); this.labels.clear(); this.owned.length = 0;
  }
}
