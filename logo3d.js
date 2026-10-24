// Logo de MDGA en 3D. Lo usan la portada (index.html, animado en bucle) y logo.html (para exportar el PNG).
// Se dibuja sobre los píxeles del logo original (1600x900): 200 px = 1 unidad, centro en (800, 450).
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';

export const P = (x, y, z = 0) => new THREE.Vector3((x - 800) / 200, (450 - y) / 200, z);
export const LOOP = 10; // segundos: la onda (3 vueltas), el brillo (2) y el balanceo (1) caben exactos

// Estudio propio para los reflejos del cromo: paneles blancos y azules sobre negro
function studioEnv(renderer) {
  const studio = new THREE.Scene();
  const panel = (w, h, rgb, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); studio.add(m);
  };
  panel(14, 3, [2.2, 2.2, 2.3], [0, 6, 2]);    // softbox cenital
  panel(1.2, 10, [1.6, 1.7, 1.9], [-7, 1, 3]); // tira blanca izquierda
  panel(1.2, 10, [0.2, 0.6, 2.4], [7, 1, 3]);  // tira azul derecha
  panel(14, 2, [0.05, 0.2, 1.2], [0, -5, 3]);  // rebote azul desde abajo
  panel(4, 1, [1.4, 1.4, 1.5], [-3, 2, 8]);    // reflejo frontal
  return new THREE.PMREMGenerator(renderer).fromScene(studio, 0.02).texture;
}

const flareTexture = () => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), m = 128;
  let grd = g.createRadialGradient(m, m, 0, m, m, m);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.05, 'rgba(170,210,255,.8)'); grd.addColorStop(0.2, 'rgba(40,110,255,.12)'); grd.addColorStop(1, 'rgba(0,40,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  for (const [w, h] of [[256, 3], [3, 140]]) { // destello horizontal largo y vertical corto
    grd = g.createLinearGradient(m - w / 2, m - h / 2, m + w / 2, m + h / 2);
    grd.addColorStop(0, 'rgba(120,180,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = grd; g.fillRect(m - w / 2, m - h / 2, w, h);
  }
  return new THREE.CanvasTexture(c);
};

function word(font, text, size, spacing, extrude, mats) {
  const g = new THREE.Group(), res = font.data.resolution;
  let x = 0;
  for (const ch of text) {
    if (ch !== ' ') {
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(font.generateShapes(ch, size), { curveSegments: 12, ...extrude }), mats);
      m.position.x = x; g.add(m);
    }
    x += font.data.glyphs[ch].ha / res * size + spacing;
  }
  const box = new THREE.Box3().setFromObject(g);
  g.children.forEach((m) => { m.position.x -= (box.min.x + box.max.x) / 2; m.position.y -= (box.min.y + box.max.y) / 2; });
  return g;
}
const fitWidth = (g, w) => { const b = new THREE.Box3().setFromObject(g); g.scale.setScalar(w / (b.max.x - b.min.x)); };

export async function createLogo(renderer, base = '') {
  const env = studioEnv(renderer);
  const group = new THREE.Group();
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.07, envMap: env });
  const blueFace = new THREE.MeshPhysicalMaterial({ color: 0x0f4dff, metalness: 0.6, roughness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.03, emissive: 0x0a3cff, emissiveIntensity: 0.75, envMap: env });
  const silverFace = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.28, emissive: 0xb8c0cc, emissiveIntensity: 0.75, envMap: env });
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x020203, metalness: 0.4, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.05, envMap: env, envMapIntensity: 0.35 });

  // ---------- Líneas de luz: núcleo + halo, puntas difuminadas, se encienden al entrar y una onda de luz las recorre ----------
  const shared = { uTime: { value: 0 }, uReveal: { value: 1 }, uPulse: { value: 1 } };
  const glowMat = (rgb, power) => new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Vector3(...rgb) }, ...shared },
    vertexShader: 'varying float u; void main(){ u = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 c; uniform float uTime, uReveal, uPulse; varying float u;
      void main(){
        float on = smoothstep(u, u + .08, uReveal * 1.1);
        float wave = exp(-pow((u - fract(uTime * .3)) * 7., 2.)) * uPulse;
        gl_FragColor = vec4(c * pow(sin(3.14159 * u), ${power.toFixed(2)}) * on * (.85 + 1.4 * wave), 1.); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
  });
  const light = (px, { z = -0.25, r = 0.012, core = [1.8, 2.5, 4.5], halo = [0.1, 0.38, 2.6], power = 0.8 } = {}) => {
    const curve = new THREE.CatmullRomCurve3(px.map(([x, y]) => P(x, y, z)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 400, r * 2.6, 8), glowMat(halo, power)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 400, r, 8), glowMat(core, power)));
  };
  const arc = (cx, cy, rad, a0, a1, n = 24) => Array.from({ length: n }, (_, i) => {
    const a = (a0 + (a1 - a0) * i / (n - 1)) * Math.PI / 180;
    return [cx + Math.cos(a) * rad, cy - Math.sin(a) * rad];
  });
  const shape = (pts) => new THREE.Shape(pts.map(([x, y]) => { const v = P(x, y); return new THREE.Vector2(v.x, v.y); }));

  // ---------- Silueta del coche ----------
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape([[92, 380], [150, 352], [300, 318], [470, 282], [565, 252], [690, 203], [810, 176], [955, 172], [1095, 192],
    [1255, 234], [1405, 270], [1475, 288], [1497, 318], [1490, 372], [1470, 460], [140, 470], [96, 420]]),
    { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.03, bevelSegments: 6, curveSegments: 24 }), paint);
  body.position.z = -0.75;
  group.add(body);
  const win = new THREE.Mesh(new THREE.ShapeGeometry(shape([[655, 266], [735, 214], [850, 190], [975, 191], [1065, 210], [1110, 250], [900, 262]])),
    new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0.9, roughness: 0.05, envMap: env }));
  win.position.z = -0.36;
  group.add(win);

  light([[330, 316], [470, 279], [600, 231], [720, 192], [850, 171], [985, 174], [1125, 199], [1285, 239], [1425, 266], [1540, 274]], { r: 0.014 }); // techo
  light([[92, 378], [150, 353], [260, 334], [400, 306], [520, 292]], { r: 0.013, core: [4, 4, 4.4] });              // aleta delantera
  light([[430, 300], [620, 292], [820, 286], [1020, 282], [1220, 286], [1390, 300], [1470, 306]], { r: 0.008, halo: [0.15, 0.5, 3] }); // línea de cintura
  light([[650, 268], [820, 262], [1010, 258], [1108, 250]], { r: 0.006, core: [1.6, 1.8, 2.2], halo: [0.05, 0.2, 1.2] }); // base ventanilla
  light([[660, 262], [742, 213], [860, 190], [980, 192], [1062, 211], [1106, 248]], { r: 0.006, core: [1.4, 1.6, 2], halo: [0.05, 0.2, 1.2] }); // marco ventanilla
  light(arc(335, 445, 105, 165, 20), { r: 0.009, halo: [0.1, 0.45, 3] });  // paso de rueda delantero
  light(arc(1225, 440, 105, 160, 15), { r: 0.009, halo: [0.1, 0.45, 3] }); // paso de rueda trasero
  light([[1380, 320], [1430, 313], [1478, 303]], { r: 0.016, core: [6, 0.5, 0.4], halo: [2, 0.05, 0.05] }); // piloto trasero
  light([[30, 693], [240, 693]], { z: 0.1, r: 0.006, power: 0.35, core: [0.6, 1.6, 4], halo: [0.05, 0.4, 2] }); // líneas junto a AUTO DETAILING
  light([[1360, 693], [1570, 693]], { z: 0.1, r: 0.006, power: 0.35, core: [0.6, 1.6, 4], halo: [0.05, 0.4, 2] });

  // ---------- Letras ----------
  const loader = new FontLoader();
  const [russo, mic] = await Promise.all(['russo-one.json', 'michroma.json'].map((f) => loader.loadAsync(base + f)));
  const mdga = word(russo, 'MDGA', 1, 0.16, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.055, bevelSegments: 6 }, [blueFace, chrome]);
  mdga.children.forEach((m) => { m.position.x *= 1.12; m.scale.x = 1.12; }); // más ancha, como el original
  fitWidth(mdga, 6.9);
  mdga.position.copy(P(792, 518, 0));
  mdga.rotation.x = -0.14; // inclinada hacia arriba para que la cara recoja el reflejo del softbox
  group.add(mdga);
  const sub = word(mic, 'AUTO DETAILING', 1, 0.28, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.018, bevelSegments: 4 }, [silverFace, chrome]);
  fitWidth(sub, 5.25);
  sub.position.copy(P(795, 700, 0));
  group.add(sub);

  // ---------- Destellos y brillo que recorre el cromo ----------
  const tex = flareTexture();
  const flares = [[1440, 266, 1.1], [1345, 382, 0.8], [232, 344, 0.9], [1105, 168, 0.45], [1225, 652, 0.35]].map(([x, y, s]) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, color: new THREE.Color(1.6, 1.7, 2) }));
    sp.position.copy(P(x, y, 0.6)); sp.scale.setScalar(s); sp.renderOrder = 10; sp.userData.s = s;
    group.add(sp);
    return sp;
  });
  const glint = new THREE.PointLight(0xcfe0ff, 0, 5, 2), wsV = new THREE.Vector3();
  group.add(glint);

  return {
    group,
    // t = segundos desde que aparece; still = foto fija para exportar
    update(t, still = false) {
      shared.uTime.value = t;
      shared.uReveal.value = still ? 1 : Math.min(1, t / 1.8);
      shared.uPulse.value = still ? 0 : 1;
      if (still) return;
      const k = (t % 5) / 5; // el brillo cruza las letras cada 5 s
      // la luz cae con la distancia real: si el logo se dibuja a escala ws, su intensidad y alcance van con ws
      const ws = group.getWorldScale(wsV).x;
      glint.position.set(-5 + k * 10, -0.4, 1.4);
      glint.distance = 5 * ws;
      glint.intensity = Math.sin(k * Math.PI) * 14 * ws * ws;
      // todo se repite exactamente cada LOOP segundos (así el vídeo del logo empalma sin corte)
      const w = (2 * Math.PI) / LOOP;
      group.rotation.y = Math.sin(t * w) * 0.07;
      group.rotation.x = Math.sin(t * w + 1.3) * 0.035;
      flares.forEach((sp, i) => sp.scale.setScalar(sp.userData.s * Math.min(1, Math.max(0, t - 1.2 - i * 0.15) * 2) * (0.75 + 0.3 * Math.sin(t * w * 3 + i * 1.7))));
    }
  };
}
