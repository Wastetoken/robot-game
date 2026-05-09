import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, ExtendedTriangle } from 'three-mesh-bvh';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { initShield, updateShield, registerShieldHit, shieldGroup, shieldLife, setShieldLife, shieldReveal, setShieldReveal, shieldMesh } from './shield.js';

// ─── BVH extensions ────────────────────────────────────────────────────────
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ─── Renderer ─────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xB5F8FF);
scene.fog = new THREE.FogExp2(0xe6d1b3, 0.01); // Light desert haze

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
camera.layers.enable(1); // Projectiles / VFX
camera.layers.enable(2); // Player / Robot

// ─── Audio System ──────────────────────────────────────────────────────────
const listener = new THREE.AudioListener();
camera.add(listener);

const sfx = {
  walking: new THREE.PositionalAudio(listener),
  running: new THREE.PositionalAudio(listener),
  jetpack: new THREE.PositionalAudio(listener),
  charge: new THREE.PositionalAudio(listener),
  fire: new THREE.PositionalAudio(listener),
  shield: new THREE.PositionalAudio(listener),
  servo: new THREE.PositionalAudio(listener)
};

const audioLoader = new THREE.AudioLoader();
const loadSFX = (name, url, loop = false, vol = 0.5) => {
  audioLoader.load(url, buffer => {
    sfx[name].setBuffer(buffer);
    sfx[name].setLoop(loop);
    sfx[name].setVolume(vol);
  });
};

loadSFX('walking', 'SFX/Movement1.mp3', true, 0.4);
loadSFX('running', 'SFX/Movement2.mp3', true, 0.6);
loadSFX('jetpack', 'SFX/Flying.mp3', true, 0.5);
loadSFX('charge', 'SFX/HoldFire.mp3', true, 0.5);
loadSFX('fire', 'SFX/SingleFire.mp3', false, 0.7);
loadSFX('shield', 'SFX/Shield.wav', false, 0.6);
loadSFX('servo', 'SFX/Mouse-Rotation.mp3', true, 0.3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.80;
document.body.appendChild(renderer.domElement);

// ─── Post Processing ──────────────────────────────────────────────────────
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.4, 0.9);
bloomPass.threshold = 0.9;
bloomPass.strength = 0.2;
bloomPass.radius = 0.05;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ─── Desert Lighting ───────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xddeeff, 0.4); // Cool skylight fill
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.2); // Warm sun
dirLight.position.set(100, 150, 100);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 4096;
dirLight.shadow.mapSize.height = 4096;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 500;
dirLight.shadow.camera.left = -200;
dirLight.shadow.camera.right = 200;
dirLight.shadow.camera.top = 200;
dirLight.shadow.camera.bottom = -200;
scene.add(dirLight);

// ─── Physics constants ─────────────────────────────────────────────────────
let environmentMesh = null;
const playerVelocity = new THREE.Vector3();
let playerOnFloor = false;
const GRAVITY = -30;
const SPEED = 5.5;
const JUMP_V = 10;
const JETPACK_FORCE = 40;
const MAX_JET_V = 8;
const CAP_HEIGHT = 1.0;
const CAP_RADIUS = 0.3;
const BASE_FOV = 75;

// ─── Player group ──────────────────────────────────────────────────────────
const playerGroup = new THREE.Group();
playerGroup.position.set(-50.0, 1.5, 0.0); // Open sand area in Egypt Map
scene.add(playerGroup);

// ─── Robot model & bones ───────────────────────────────────────────────────
let robotModel = null, mixer = null, runAction = null;
let muzzlePoint = null;
let jetpackLight = null;
let isJetpacking = false;
let shieldActive = false;
let isMouseMoving = false;
let mouseMoveTimer = 0;
const robotBones = { body: null, rootLegs: [] };

// ─── Camera rig ───────────────────────────────────────────────────────────
const cameraContainer = new THREE.Group();
scene.add(cameraContainer);

const cameraPivot = new THREE.Group();
cameraPivot.rotation.order = 'YXZ';
cameraContainer.add(cameraPivot);
cameraPivot.position.set(0, 0.9, 0);

const cameraRig = new THREE.Group();
cameraPivot.add(cameraRig);
cameraRig.position.set(0, 0, 5.0);
cameraRig.add(camera);

// ─── Input ────────────────────────────────────────────────────────────────
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false, ctrl: false };
document.addEventListener('keydown', e => {
  if (e.code === 'KeyW') keys.w = true;
  if (e.code === 'KeyA') keys.a = true;
  if (e.code === 'KeyS') keys.s = true;
  if (e.code === 'KeyD') keys.d = true;
  if (e.code === 'Space') keys.space = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') keys.ctrl = true;
  
  if (e.code === 'KeyQ') {
    shieldActive = !shieldActive;
    if (shieldActive) {
      setShieldReveal(1.0); // Replay dissolve on activation
    }
    if (sfx.shield.buffer) {
      if (sfx.shield.isPlaying) sfx.shield.stop();
      sfx.shield.play();
    }
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'KeyW') keys.w = false;
  if (e.code === 'KeyA') keys.a = false;
  if (e.code === 'KeyS') keys.s = false;
  if (e.code === 'KeyD') keys.d = false;
  if (e.code === 'Space') keys.space = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') keys.ctrl = false;
});

// ─── Pointer lock ─────────────────────────────────────────────────────────
const chargeBar = document.getElementById('charge-bar');
const chargeFill = document.getElementById('charge-fill');
const instructions = document.getElementById('instructions');
let isLocked = false;
instructions.addEventListener('click', () => document.body.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === document.body;
  instructions.style.display = isLocked ? 'none' : 'flex';
});

let pitch = 0, yaw = 0;
let smoothPitch = 0, smoothYaw = 0;
document.addEventListener('mousemove', e => {
  if (!isLocked) return;
  yaw -= (e.movementX || 0) * 0.002;
  pitch -= (e.movementY || 0) * 0.002;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  
  if (Math.abs(e.movementX) > 0.1 || Math.abs(e.movementY) > 0.1) {
    isMouseMoving = true;
    mouseMoveTimer = 0.1; // maintain for 100ms
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PROJECTILE SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

// ─── Projectile pool ──────────────────────────────────────────────────────
const MAX_PROJ = 64;
const projectiles = Array.from({ length: MAX_PROJ }, () => ({
  active: false,
  position: new THREE.Vector3(),
  prevPosition: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  charge: 0,
  age: 0,
  maxAge: 4.0,
  radius: 0,
  mesh: null,
  lightSlot: null,
  trailTimer: 0,
}));

// ─── Dynamic light pool ───────────────────────────────────────────────────
const MAX_LIGHTS = 8;
const lightPool = Array.from({ length: MAX_LIGHTS }, () => {
  const light = new THREE.PointLight(0xFFAA00, 0, 60);
  light.castShadow = false;
  scene.add(light);
  return { light, dying: false, decayRate: 8, projectileId: -1 };
});

function acquireLight() {
  // Prefer idle slot
  for (const s of lightPool) if (!s.dying && s.light.intensity === 0) return s;
  // Fall back to dimmest dying slot
  let dimmest = lightPool[0];
  for (const s of lightPool) if (s.light.intensity < dimmest.light.intensity) dimmest = s;
  return dimmest;
}

function releaseLight(slot) {
  slot.dying = true;
  slot.decayRate = 12;
}

function flashImpactLight(position, charge) {
  const slot = acquireLight();
  slot.light.position.copy(position);
  slot.light.intensity = 4 + charge * 16;
  slot.light.distance = 5 + charge * 18;
  // Rapid = cyan-blue, charged = white-hot orange core
  slot.light.color.setHSL(0.58 - charge * 1.42, 1.0, 0.6 + charge * 1.3);
  slot.dying = true;
  slot.decayRate = 6 + charge * 8;
}

// ─── Projectile meshes (shared geometry) ──────────────────────────────────
const projGeoSmall = new THREE.SphereGeometry(0.06, 8, 8);
const projGeoLarge = new THREE.SphereGeometry(0.24, 12, 12);
const projMatRapid = new THREE.MeshStandardMaterial({
  color: 0xFFAA00, emissive: 0xFFAA00, emissiveIntensity: 5,
  metalness: 1, roughness: 0, transparent: true, opacity: 0.9,
});
const projMatCharge = new THREE.MeshStandardMaterial({
  color: 0xFFAA00, emissive: 0xFFAA00, emissiveIntensity: 10,
  metalness: 0.3, roughness: 1, transparent: true, opacity: 1.0,
});

const spriteMatRapid = new THREE.SpriteMaterial({
  map: buildParticleTexture(), color: 0xFFAA00, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.8
});
const spriteMatCharge = new THREE.SpriteMaterial({
  map: buildParticleTexture(), color: 0xFFAA00, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.9
});

function spawnProjectile(charge) {
  // Find free slot
  let proj = null;
  for (const p of projectiles) { if (!p.active) { proj = p; break; } }
  if (!proj) return;

  // Muzzle world position
  const muzzleWorld = _tempV1;
  if (muzzlePoint) {
    muzzlePoint.getWorldPosition(muzzleWorld);
  } else {
    // Fallback if not loaded
    muzzleWorld.copy(playerGroup.position).add(new THREE.Vector3(0, 0.07, 0));
  }

  // Fire direction: camera forward
  const fireDir = _tempV2;
  camera.getWorldDirection(fireDir);

  const isCharged = charge > 0.15;
  const speed = isCharged ? (5 + charge * 5) : 10;
  const radius = isCharged ? (0.008 + charge * 0.32) : 0.006;

  if (!isCharged && sfx.fire.buffer) {
    if (sfx.fire.isPlaying) sfx.fire.stop();
    sfx.fire.play();
  }

  proj.active = true;
  proj.charge = charge;
  proj.age = 0;
  proj.maxAge = isCharged ? 5.0 : 3.0;
  proj.radius = radius;
  proj.trailTimer = 0;
  proj.position.copy(muzzleWorld);
  // Push spawn point slightly ahead to clear robot geometry
  proj.position.addScaledVector(fireDir, 0.1);
  proj.prevPosition.copy(proj.position);
  proj.velocity.copy(fireDir).multiplyScalar(speed);

  // Mesh
  if (!proj.mesh) {
    const geo = isCharged ? projGeoLarge : projGeoSmall;
    const mat = isCharged ? projMatCharge.clone() : projMatRapid.clone();
    proj.mesh = new THREE.Mesh(geo, mat);
    proj.mesh.name = 'projectile';
    proj.mesh.castShadow = false;
    proj.mesh.layers.set(1); // Visual layer
    scene.add(proj.mesh);
  } else {
    proj.mesh.visible = true;
  }
  proj.mesh.scale.setScalar(1);
  proj.mesh.position.copy(muzzleWorld);

  // Glow Sprite
  if (!proj.glow) {
    proj.glow = new THREE.Sprite(isCharged ? spriteMatCharge : spriteMatRapid);
    proj.glow.layers.set(1); // Visual layer
    scene.add(proj.glow);
  } else {
    proj.glow.visible = true;
  }
  proj.glow.scale.setScalar(isCharged ? 1.15 : 0.15);

  // Small muzzle flash (particles)
  const flashCount = isCharged ? 3 : 1;
  for (let k = 0; k < flashCount; k++) {
    emitParticle(
      muzzleWorld.x, muzzleWorld.y, muzzleWorld.z,
      fireDir.x * 2 + (Math.random() - 0.5) * 1.5,
      fireDir.y * 2 + (Math.random() - 0.5) * 1.5,
      fireDir.z * 2 + (Math.random() - 0.5) * 1.5,
      0, 0.15, 0.05, 1, 0.9, 0.4
    );
  }

  // Acquire a dynamic light for this projectile
  const slot = acquireLight();
  slot.dying = false;
  slot.decayRate = 0;
  slot.projectileId = projectiles.indexOf(proj);
  slot.light.color.setHSL(isCharged ? 0.08 : 0.58, 1.0, 0.6);
  slot.light.intensity = isCharged ? (1.0 + charge * 2) : 0.6;
  slot.light.distance = isCharged ? (4 + charge * 8) : 4;
  proj.lightSlot = slot;
}

function despawnProjectile(proj) {
  proj.active = false;
  if (proj.mesh) proj.mesh.visible = false;
  if (proj.glow) proj.glow.visible = false;
  if (proj.lightSlot) {
    releaseLight(proj.lightSlot);
    proj.lightSlot = null;
  }
}

// ─── Input: fire mode ─────────────────────────────────────────────────────
const CHARGE_THRESHOLD = 0.15;   // seconds — below = rapid, above = charge
const MAX_CHARGE_TIME = 1.0;
const RAPID_COOLDOWN = 0.09;   // 90ms between rapid pellets

let mouseDownTime = null;
let rapidFireTimer = 0;
let isCharging = false;
let chargeT = 0;

window.addEventListener('mousedown', e => {
  if (e.button !== 0 || !isLocked) return;
  mouseDownTime = clock.getElapsedTime();
  isCharging = false;
  chargeT = 0;
  rapidFireTimer = 0;
});

window.addEventListener('mouseup', e => {
  if (e.button !== 0 || !isLocked || mouseDownTime === null) return;
  const held = clock.getElapsedTime() - mouseDownTime;
  if (held >= CHARGE_THRESHOLD) {
    const t = Math.min(held / MAX_CHARGE_TIME, 1.0);
    spawnProjectile(t);
  }
  mouseDownTime = null;
  isCharging = false;
  chargeT = 0;
  // Reset FOV
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  chargeVFX.visible = false;
  chargeBar.style.display = 'none';
});

// ══════════════════════════════════════════════════════════════════════════════
// PARTICLE SYSTEM (CPU → GPU instanced, WebGPU-ready architecture)
// ══════════════════════════════════════════════════════════════════════════════

const MAX_PARTICLES = 16000;
const PARTICLE_STRIDE = 9; // px py pz vx vy vz age maxAge size

// Flat typed arrays — GPU-friendly layout, zero GC
const pPos = new Float32Array(MAX_PARTICLES * 3); // positions for Points
const pData = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
const pColor = new Float32Array(MAX_PARTICLES * 3);
const pSize = new Float32Array(MAX_PARTICLES);
let pHead = 0; // ring buffer head

function emitParticle(px, py, pz, vx, vy, vz, age0, maxAge, size, r, g, b) {
  const i = pHead % MAX_PARTICLES;
  const d = i * PARTICLE_STRIDE;
  pData[d + 0] = px; pData[d + 1] = py; pData[d + 2] = pz;
  pData[d + 3] = vx; pData[d + 4] = vy; pData[d + 5] = vz;
  pData[d + 6] = age0; pData[d + 7] = maxAge; pData[d + 8] = size;
  pColor[i * 3] = r; pColor[i * 3 + 1] = g; pColor[i * 3 + 2] = b;
  pHead++;
}

function emitTrailParticles(proj) {
  const isCharged = proj.charge > 0.85;
  const rate = isCharged ? 0.016 : 0.078; // emit every N seconds
  proj.trailTimer += 0.016; // approx per frame
  if (proj.trailTimer < rate) return;
  proj.trailTimer = 0;

  const count = isCharged ? Math.ceil(1 + proj.charge * 4) : 2;
  for (let k = 0; k < count; k++) {
    const spread = isCharged ? 0.08 : 0.03;
    emitParticle(
      proj.position.x + (Math.random() - 0.5) * spread,
      proj.position.y + (Math.random() - 0.5) * spread,
      proj.position.z + (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.4 + 0.3, // slight upward drift
      (Math.random() - 0.5) * 0.4,
      0, isCharged ? 0.35 : 0.22,
      isCharged ? (0.12 + proj.charge * 0.18) : 0.07,
      isCharged ? 1.0 : 0.1,
      isCharged ? 0.4 : 0.7,
      isCharged ? 0.0 : 1.0,
    );
  }
}

function emitImpactBurst(px, py, pz, nx, ny, nz, charge) {
  const count = Math.floor(120 + charge * 500);
  for (let k = 0; k < count; k++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const spd = 1.5 + Math.random() * (3 + charge * 8);
    const vx = Math.sin(phi) * Math.cos(theta) * spd + nx * spd * 0.4;
    const vy = Math.cos(phi) * spd + ny * spd * 0.4;
    const vz = Math.sin(phi) * Math.sin(theta) * spd + nz * spd * 0.4;
    const life = 0.3 + Math.random() * (0.5 + charge * 0.6);
    const size = 0.04 + Math.random() * (0.08 + charge * 0.14);
    // Core: white-orange; outer: cyan-blue
    const t = Math.random();
    const r = 1.0;
    const g = t < 0.4 ? 0.6 + t * 0.8 : 0.2;
    const b = t < 0.4 ? 0.1 : t;
    emitParticle(px, py, pz, vx, vy, vz, 0, life, size, r, g, b);
  }
}

function emitChargeParticles(px, py, pz, charge) {
  const count = Math.floor(1 + charge * 3);
  for (let k = 0; k < count; k++) {
    const theta = Math.random() * Math.PI * 2;
    const r2 = 0.1 + charge * 0.25;
    const vx = Math.cos(theta) * (1 + charge * 2);
    const vy = Math.random() * 0.5;
    const vz = Math.sin(theta) * (1 + charge * 2);
    emitParticle(
      px + Math.cos(theta) * r2,
      py + (Math.random() - 0.5) * 0.2,
      pz + Math.sin(theta) * r2,
      vx * -0.3, vy, vz * -0.3, // spiral inward
      0, 0.25 + charge * 0.2,
      0.05 + charge * 0.12,
      0.4, 0.8 + charge * 0.2, 1.0,
    );
  }
}

function emitJetpackParticles(px, py, pz, vx, vy, vz) {
  // Triple-layer Afterburner Effect
  const count = 10;
  for (let k = 0; k < count; k++) {
    const spread = 0.05;
    
    // 1. Plasma Core (High speed, white-hot cyan)
    const lifeCore = 0.1 + Math.random() * 0.2;
    const sizeCore = 0.4 + Math.random() * 0.5;
    emitParticle(
      px + (Math.random() - 0.5) * spread,
      py,
      pz + (Math.random() - 0.5) * spread,
      vx + (Math.random() - 0.5) * 1.5,
      vy - 18.0 - Math.random() * 10.0, 
      vz + (Math.random() - 0.5) * 1.5,
      0, lifeCore, sizeCore,
      0.8, 1.0, 1.0 // White-Cyan
    );

    // 2. Plasma Bloom (Large, soft cyan, creates the "thick" trail)
    const lifeBloom = 0.4 + Math.random() * 0.4;
    const sizeBloom = 0.8 + Math.random() * 1.2;
    emitParticle(
      px + (Math.random() - 0.5) * 0.2,
      py,
      pz + (Math.random() - 0.5) * 0.2,
      vx * 0.8 + (Math.random() - 0.5) * 2.0,
      vy * 0.5 - 8.0 - Math.random() * 4.0,
      vz * 0.8 + (Math.random() - 0.5) * 2.0,
      0, lifeBloom, sizeBloom,
      0.0, 0.6, 1.0 // Deep Plasma Blue
    );

    // 3. High-Energy Sparks
    if (k % 3 === 0) {
      emitParticle(
        px, py, pz,
        vx + (Math.random() - 0.5) * 10.0,
        vy - 5.0 - Math.random() * 20.0,
        vz + (Math.random() - 0.5) * 10.0,
        0, 0.15, 0.15,
        1.0, 1.0, 1.0
      );
    }
  }
}

// Three.js Points object for rendering
const particleGeo = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
const colAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
const szAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
const lifeAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
posAttr.setUsage(THREE.DynamicDrawUsage);
colAttr.setUsage(THREE.DynamicDrawUsage);
szAttr.setUsage(THREE.DynamicDrawUsage);
lifeAttr.setUsage(THREE.DynamicDrawUsage);
particleGeo.setAttribute('position', posAttr);
particleGeo.setAttribute('color', colAttr);
particleGeo.setAttribute('aSize', szAttr);
particleGeo.setAttribute('aLife', lifeAttr);

const particleMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTex: { value: buildParticleTexture() }
  },
  vertexShader: `
    attribute float aSize;
    attribute float aLife;
    varying float vLife;
    varying vec3 vColor;
    void main() {
      vLife = aLife;
      vColor = color;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (700.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform sampler2D uTex;
    varying float vLife;
    varying vec3 vColor;
    void main() {
      vec4 tex = texture2D(uTex, gl_PointCoord);
      gl_FragColor = vec4(vColor, vLife * tex.a);
    }
  `
});

const particleMesh = new THREE.Points(particleGeo, particleMat);
particleMesh.layers.set(1); // Visual layer
scene.add(particleMesh);

function buildParticleTexture() {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

function tickParticles(delta) {
  let liveCount = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const d = i * PARTICLE_STRIDE;
    let age = pData[d + 6];
    const maxA = pData[d + 7];
    if (age >= maxA) {
      // dead — set size to 0 so it's invisible but slot reusable
      szAttr.array[i] = 0;
      continue;
    }
    age += delta;
    pData[d + 6] = age;

    // Integrate position
    pData[d + 3] *= (1 - delta * 2.5); // drag
    pData[d + 4] += GRAVITY * 0.015 * delta;
    pData[d + 5] *= (1 - delta * 2.5);
    pData[d + 0] += pData[d + 3] * delta;
    pData[d + 1] += pData[d + 4] * delta;
    pData[d + 2] += pData[d + 5] * delta;

    const t = age / maxA;
    const life = 1 - t;

    // Write to render buffer
    posAttr.array[i * 3 + 0] = pData[d + 0];
    posAttr.array[i * 3 + 1] = pData[d + 1];
    posAttr.array[i * 3 + 2] = pData[d + 2];
    colAttr.array[i * 3 + 0] = pColor[i * 3 + 0];
    colAttr.array[i * 3 + 1] = pColor[i * 3 + 1];
    colAttr.array[i * 3 + 2] = pColor[i * 3 + 2];
    szAttr.array[i] = pData[d + 8]; 
    lifeAttr.array[i] = life * life; // quadratic fade

    liveCount++;
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  szAttr.needsUpdate = true;
  lifeAttr.needsUpdate = true;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHARGE VFX (corona ring + local particles)
// ══════════════════════════════════════════════════════════════════════════════

// Simple ring mesh that scales with charge
const chargeRingGeo = new THREE.TorusGeometry(0.18, 0.02, 8, 32);
const chargeRingMat = new THREE.MeshStandardMaterial({
  color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 4,
  transparent: true, opacity: 0.8, side: THREE.DoubleSide,
});
const chargeVFX = new THREE.Mesh(chargeRingGeo, chargeRingMat);
chargeVFX.visible = false;
playerGroup.add(chargeVFX);
chargeVFX.position.set(0.3, 0.7, -0.5);

// Charge light (always at muzzle while charging)
const chargeLight = new THREE.PointLight(0x00ffff, 0, 4);
chargeLight.castShadow = false;
playerGroup.add(chargeLight);
chargeLight.position.set(0.3, 0.7, -0.5);

// ─── Collision helpers ────────────────────────────────────────────────────
const _closestPt = new THREE.Vector3();
const _chkSeg = new THREE.Line3();

function pointInCapsule(point, capStart, capEnd, radius) {
  _chkSeg.set(capStart, capEnd);
  _chkSeg.closestPointToPoint(point, true, _closestPt);
  return point.distanceToSquared(_closestPt) < radius * radius;
}

// ─── Impact ───────────────────────────────────────────────────────────────

// ─── Impact ───────────────────────────────────────────────────────────────
function handleImpact(position, normal, charge, targetObj = null) {
  // Shield interaction
  if (shieldActive && (targetObj === shieldMesh || (targetObj && targetObj.layers.isEnabled(2)))) {
    registerShieldHit(position);
    const damage = charge > 0.5 ? 0.25 : 0.08;
    setShieldLife(shieldLife - damage);
    // Shield absorbs energy, so we can exit early or play a different effect
    flashImpactLight(position, charge * 0.5);
    return true; // Impact absorbed by shield
  }

  flashImpactLight(position, charge);
  emitImpactBurst(
    position.x, position.y, position.z,
    normal.x, normal.y, normal.z,
    charge,
  );
  // Charged shot: decal flash light lingers slightly longer via low decayRate
}

// ─── Projectile update ────────────────────────────────────────────────────
const _pRayDir = new THREE.Vector3();
const _pRay = new THREE.Raycaster();
const _capS = new THREE.Vector3();
const _capE = new THREE.Vector3();

function updateProjectiles(delta) {
  // ── Fire input ───────────────────────────────────────────────────────────
  if (mouseDownTime !== null) {
    const held = clock.getElapsedTime() - mouseDownTime;
    if (held < CHARGE_THRESHOLD) {
      // Rapid fire — time-gated
      rapidFireTimer -= delta;
      if (rapidFireTimer <= 0) {
        spawnProjectile(0);
        rapidFireTimer = RAPID_COOLDOWN;
      }
      chargeVFX.visible = false;
      chargeLight.intensity = 0;
      chargeBar.style.display = 'none';
    } else {
      // Charge mode
      isCharging = true;
      chargeT = Math.min(held / MAX_CHARGE_TIME, 1.0);

      if (sfx.charge.buffer && !sfx.charge.isPlaying) {
        sfx.charge.play();
      }

      // UI update
      chargeBar.style.display = 'block';
      chargeFill.style.width = (chargeT * 100) + '%';
      chargeFill.style.background = chargeT > 0.8 ? '#fff' : `linear-gradient(90deg, #ff4d4d, #ffcc00)`;

      // Charge VFX update
      chargeVFX.visible = true;
      chargeVFX.scale.setScalar(0.6 + chargeT * 1.8);
      chargeVFX.rotation.z += delta * (3 + chargeT * 8);
      chargeRingMat.emissiveIntensity = 3 + chargeT * 8;
      chargeRingMat.opacity = 0.5 + chargeT * 0.5;
      chargeLight.intensity = chargeT * 3;
      chargeLight.distance = 1 + chargeT * 5;
      chargeLight.color.setHSL(0.5 - chargeT * 0.08, 1, 0.6);

      // Narrow FOV for tension
      camera.fov = THREE.MathUtils.lerp(BASE_FOV, 68, chargeT);
      camera.updateProjectionMatrix();

      // Emit swirling charge particles at muzzle
      if (muzzlePoint) {
        const mw = _tempV1;
        muzzlePoint.getWorldPosition(mw);
        emitChargeParticles(mw.x, mw.y, mw.z, chargeT);
      }

      // Auto-fire at full charge
      if (chargeT >= 1.0) {
        spawnProjectile(1.0);
        mouseDownTime = null; 
        isCharging = false;
        if (sfx.charge.isPlaying) sfx.charge.stop();
        chargeVFX.visible = false;
        chargeLight.intensity = 0;
        chargeBar.style.display = 'none';
        camera.fov = BASE_FOV;
        camera.updateProjectionMatrix();
      }
    }
  }

  // ── Tick all active projectiles ──────────────────────────────────────────
  for (let pi = 0; pi < projectiles.length; pi++) {
    const proj = projectiles[pi];
    if (!proj.active) continue;

    proj.age += delta;
    if (proj.age > proj.maxAge) { despawnProjectile(proj); continue; }

    // Store prev position for sweep
    proj.prevPosition.copy(proj.position);

    // Slight arc gravity (feels good, not too floaty)
    proj.velocity.y += GRAVITY * 0.0009 * delta;

    // Move
    proj.position.addScaledVector(proj.velocity, delta);

    // Sync light
    if (proj.lightSlot) {
      proj.lightSlot.light.position.copy(proj.position);
      // Pulse intensity slightly for life feel
      const pulse = 1 + Math.sin(proj.age * 18) * 0.15;
      proj.lightSlot.light.intensity = (proj.charge > 0.15
        ? (1.5 + proj.charge * 1.5)
        : 1.0) * pulse;
    }

    // Sync mesh & glow
    if (proj.mesh) {
      proj.mesh.position.copy(proj.position);
      if (proj.charge > 0.15) {
        const s = 1.0 + Math.sin(proj.age * 20) * 0.1;
        proj.mesh.scale.setScalar(s);
      }
    }
    if (proj.glow) {
      proj.glow.position.copy(proj.position);
      if (proj.charge > 0.15) {
        const gs = (1.5 + Math.sin(proj.age * 25) * 0.3) * (1 + proj.charge);
        proj.glow.scale.setScalar(gs);
      }
    }

    // Trail particles
    emitTrailParticles(proj);

    if (environmentMesh) {
      const sweepOrigin = proj.prevPosition.clone();
      const sweepDir = new THREE.Vector3().subVectors(proj.position, proj.prevPosition);
      const sweepDist = sweepDir.length();
      sweepDir.normalize();

      const ray = new THREE.Raycaster(sweepOrigin, sweepDir, 0, sweepDist + proj.radius + 0.1);
      ray.layers.set(0); // Only intersect environment
      const hits = ray.intersectObject(environmentMesh, true);
      
      // Check shield collision if active (One-way: only blocks incoming)
      let shieldHit = null;
      if (shieldActive && shieldMesh) {
        const sHits = ray.intersectObject(shieldMesh);
        if (sHits.length > 0) {
          const sHit = sHits[0];
          // Use dot product to determine if hit is from outside (incoming)
          const dot = ray.ray.direction.dot(sHit.face.normal);
          if (dot < 0 && (!hits.length || sHit.distance < hits[0].distance)) {
            shieldHit = sHit;
          }
        }
      }

      if (shieldHit) {
        handleImpact(shieldHit.point, shieldHit.face.normal, proj.charge, shieldMesh);
        despawnProjectile(proj);
        continue;
      }

      if (hits.length > 0) {
        const hit = hits[0];
        const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
        handleImpact(hit.point, normal, proj.charge, hit.object);
        despawnProjectile(proj);
        continue;
      }
    }

    // ── Player self-hit guard (skip if within 0.5s of spawn) ──────────────
    if (proj.age > 0.5) {
      _capS.set(0, CAP_RADIUS, 0).add(playerGroup.position);
      _capE.set(0, CAP_HEIGHT + CAP_RADIUS, 0).add(playerGroup.position);
      if (pointInCapsule(proj.position, _capS, _capE, CAP_RADIUS + proj.radius)) {
        handleImpact(proj.position.clone(), new THREE.Vector3(0, 1, 0), proj.charge, playerGroup);
        despawnProjectile(proj);
        continue;
      }
    }
  }

  // ── Projectile vs projectile sphere-sphere ─────────────────────────────
  for (let i = 0; i < projectiles.length; i++) {
    if (!projectiles[i].active) continue;
    for (let j = i + 1; j < projectiles.length; j++) {
      if (!projectiles[j].active) continue;
      const d2 = projectiles[i].position.distanceToSquared(projectiles[j].position);
      const rSum = projectiles[i].radius + projectiles[j].radius;
      if (d2 < rSum * rSum) {
        const midPt = projectiles[i].position.clone().lerp(projectiles[j].position, 0.5);
        const charge = Math.max(projectiles[i].charge, projectiles[j].charge);
        handleImpact(midPt, new THREE.Vector3(0, 1, 0), charge);
        despawnProjectile(projectiles[i]);
        despawnProjectile(projectiles[j]);
      }
    }
  }

  // ── Decay dying lights ────────────────────────────────────────────────────
  for (const slot of lightPool) {
    if (!slot.dying) continue;
    slot.light.intensity *= Math.exp(-slot.decayRate * delta);
    if (slot.light.intensity < 0.01) {
      slot.light.intensity = 0;
      slot.dying = false;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PHYSICS
// ══════════════════════════════════════════════════════════════════════════════

const _tempMat = new THREE.Matrix4();
const _tempV1 = new THREE.Vector3();
const _tempV2 = new THREE.Vector3();
const _tempV3 = new THREE.Vector3(); // Extra scratch
const _tempV4 = new THREE.Vector3(); // Extra scratch
const _tempETri = new ExtendedTriangle();

function updatePhysics(delta) {
  if (!environmentMesh) return;

  const physicsSubSteps = 8; // Ultra-high precision
  const subDelta = delta / physicsSubSteps;

  for (let s = 0; s < physicsSubSteps; s++) {
    const moveDir = new THREE.Vector3();
    if (keys.w) moveDir.z -= 1;
    if (keys.s) moveDir.z += 1;
    if (keys.a) moveDir.x -= 1;
    if (keys.d) moveDir.x += 1;

    const hasInput = moveDir.lengthSq() > 0;
    let animScale = 1.0;

    if (hasInput) {
      moveDir.normalize();
      moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

      if (keys.shift) { animScale = 2.0; }
      else if (keys.ctrl) { animScale = 0.5; }

      const accelBase = playerOnFloor ? 35 : 12;
      const sprintMultiplier = keys.shift ? 1.8 : 1.0;
      const accel = accelBase * sprintMultiplier;

      playerVelocity.x += moveDir.x * accel * subDelta;
      playerVelocity.z += moveDir.z * accel * subDelta;
    }

    const friction = playerOnFloor ? 22 : 2.5;
    playerVelocity.x *= Math.max(0, 1 - friction * subDelta);
    playerVelocity.z *= Math.max(0, 1 - friction * subDelta);

    if (s === 0 && playerOnFloor && keys.space) playerVelocity.y = JUMP_V;

    playerVelocity.y += playerOnFloor ? 0 : GRAVITY * subDelta;

    // ── Jetpack Logic ────────────────────────────────────────────────────────
    isJetpacking = !playerOnFloor && keys.space && playerVelocity.y < MAX_JET_V;
    if (isJetpacking) {
      playerVelocity.y += JETPACK_FORCE * subDelta;
      if (s === 0) {
        // Particles from each leg, or fallback to player base if bones missing
        if (robotModel && robotBones.rootLegs && robotBones.rootLegs.length > 0) {
          const pos = _tempV1;
          robotBones.rootLegs.forEach(leg => {
            leg.getWorldPosition(pos);
            emitJetpackParticles(pos.x, pos.y, pos.z, playerVelocity.x, playerVelocity.y, playerVelocity.z);
          });
        } else {
          // Robust fallback: spawn directly under the robot chassis
          emitJetpackParticles(
            playerGroup.position.x, 
            playerGroup.position.y + 0.2, 
            playerGroup.position.z, 
            playerVelocity.x, playerVelocity.y, playerVelocity.z
          );
        }
        if (jetpackLight) {
          jetpackLight.intensity = 20.0 + Math.random() * 115.0;
          jetpackLight.position.copy(playerGroup.position).y += 0.0006;
        }
      }
    } else if (s === 0 && jetpackLight) {
      jetpackLight.intensity = 0;
    }

    playerGroup.position.addScaledVector(playerVelocity, subDelta);

    // ── SFX Sync ─────────────────────────────────────────────────────────────
    if (s === 0) {
      const isMoving = Math.abs(moveDir.x) > 0.1 || Math.abs(moveDir.z) > 0.1;
      
      // Movement
      if (isMoving && playerOnFloor) {
        if (keys.shift) {
          if (!sfx.running.isPlaying) sfx.running.play();
          if (sfx.walking.isPlaying) sfx.walking.stop();
        } else {
          if (!sfx.walking.isPlaying) sfx.walking.play();
          if (sfx.running.isPlaying) sfx.running.stop();
        }
      } else {
        if (sfx.walking.isPlaying) sfx.walking.stop();
        if (sfx.running.isPlaying) sfx.running.stop();
      }

      // Jetpack
      if (isJetpacking) {
        if (!sfx.jetpack.isPlaying) sfx.jetpack.play();
      } else {
        if (sfx.jetpack.isPlaying) sfx.jetpack.stop();
      }
    }

    // Collision Sweep
    const crouchH = keys.ctrl ? CAP_HEIGHT * 0.6 : CAP_HEIGHT;
    const capsuleStart = new THREE.Vector3(0, CAP_RADIUS, 0).add(playerGroup.position);
    const capsuleEnd = new THREE.Vector3(0, crouchH + CAP_RADIUS, 0).add(playerGroup.position);

    playerOnFloor = false;

    environmentMesh.traverse(child => {
      if (!child.isMesh || !child.geometry.boundsTree) return;
      if (child.layers.isEnabled(2)) return; // Skip player geometry

      _tempMat.copy(child.matrixWorld).invert();
      const localS = new THREE.Vector3().copy(capsuleStart).applyMatrix4(_tempMat);
      const localE = new THREE.Vector3().copy(capsuleEnd).applyMatrix4(_tempMat);
      const localLine = new THREE.Line3(localS, localE);

      const localCenter = new THREE.Vector3().addVectors(localS, localE).multiplyScalar(0.5);
      const localRadius = localS.distanceTo(localE) * 0.5 + CAP_RADIUS;
      const localSphere = new THREE.Sphere(localCenter, localRadius);

      child.geometry.boundsTree.shapecast({
        intersectsBounds: box => box.intersectsSphere(localSphere),
        intersectsTriangle: tri => {
          const dist = tri.closestPointToSegment(localLine, _tempV1, _tempV2);
          if (dist < CAP_RADIUS) {
            const normalLocal = _tempV3.subVectors(_tempV2, _tempV1).normalize();
            const normalWorld = normalLocal.transformDirection(child.matrixWorld);
            const overlap = CAP_RADIUS - dist;

            // Push player in world space
            playerGroup.position.addScaledVector(normalWorld, overlap);

            // Sync both local and world capsule points IMMEDIATELY
            capsuleStart.addScaledVector(normalWorld, overlap);
            capsuleEnd.addScaledVector(normalWorld, overlap);
            localS.addScaledVector(normalLocal, overlap);
            localE.addScaledVector(normalLocal, overlap);

            if (normalWorld.y > 0.5) {
              playerOnFloor = true;
              playerVelocity.y = Math.max(0, playerVelocity.y);
            }
          }
        }
      });
    });
  }

  if (playerOnFloor) playerVelocity.y = 0;

  // Ground Snapping (Final safety check to prevent fall-through)
  if (!playerOnFloor && playerVelocity.y <= 0) {
    const rayOrigin = playerGroup.position.clone().add(new THREE.Vector3(0, 1, 0));
    const snapRay = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 1.2);
    snapRay.layers.set(0); // Environment only
    const groundHits = snapRay.intersectObject(environmentMesh, true);
    if (groundHits.length > 0) {
      const groundY = groundHits[0].point.y;
      if (playerGroup.position.y < groundY + 0.05) {
        playerGroup.position.y = groundY;
        playerOnFloor = true;
        playerVelocity.y = 0;
      }
    }
  }

  const camAlpha = 1 - Math.exp(-24 * delta);
  smoothYaw += (yaw - smoothYaw) * camAlpha;
  smoothPitch += (pitch - smoothPitch) * camAlpha;
  cameraPivot.rotation.y = smoothYaw;
  cameraRig.rotation.x = smoothPitch;

  if (playerGroup.position.y < -50) {
    playerGroup.position.set(-50.0, 1.5, 0.0);
    playerVelocity.set(0, 0, 0);
  }

  cameraContainer.position.copy(playerGroup.position);
  cameraContainer.updateMatrixWorld();
  const pivotW = new THREE.Vector3();
  cameraPivot.getWorldPosition(pivotW);
  const rigQ = new THREE.Quaternion();
  cameraRig.getWorldQuaternion(rigQ);
  const camDir = new THREE.Vector3(0, 0, 1).applyQuaternion(rigQ);
  const camCaster = new THREE.Raycaster(pivotW, camDir, 0.05, 3.0);
  camCaster.layers.set(0); // Environment only
  const camHits = camCaster.intersectObject(environmentMesh, true);
  const targetZ = camHits.length > 0 ? Math.max(0.5, camHits[0].distance - 0.2) : 3.0;
  cameraRig.position.z += (targetZ - cameraRig.position.z) * (1 - Math.exp(-15 * delta));
}

// ══════════════════════════════════════════════════════════════════════════════
// ASSET LOADING
// ══════════════════════════════════════════════════════════════════════════════

const loader = new GLTFLoader();

loader.load('https://pub-a56d70d158b1414d83c3856ea210601c.r2.dev/EgyptMap_GLB.glb', gltf => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  model.traverse(child => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.layers.set(0);
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.side = THREE.DoubleSide);
      } else {
        child.material.side = THREE.DoubleSide;
      }
    }
    child.geometry.computeBoundsTree();
  });
  environmentMesh = model;
  scene.add(model);
  window.environmentMesh = environmentMesh;
});

loader.load('https://pub-a56d70d158b1414d83c3856ea210601c.r2.dev/orb-ROBOT.glb', gltf => {
  robotModel = gltf.scene;
  robotModel.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.layers.set(2); // Assign to Player Layer
    }
    if (child.isBone) {
      if (child.name === 'Body_Up') robotBones.body = child;
      if (child.name.match(/^Leg\d+$/)) robotBones.rootLegs.push(child);
    }
  });
  robotModel.scale.set(0.15, 0.15, 0.15);
  playerGroup.add(robotModel);

  // Muzzle point attached to robot so it rotates!
  const muzzlePointInternal = new THREE.Object3D();
  muzzlePointInternal.position.set(0, 4.5, -5.0); // Moved further forward to clear robot body
  robotModel.add(muzzlePointInternal);
  muzzlePoint = muzzlePointInternal;
  window.muzzlePoint = muzzlePoint; // Global reference for spawnProjectile

  jetpackLight = new THREE.PointLight(0x4488ff, 0, 6);
  scene.add(jetpackLight);

  // Initialize Shield
  initShield(scene);
  playerGroup.add(shieldGroup);
  shieldGroup.position.set(0, 0.7, 0); // Center on robot

  // Attach positional audio to robot
  Object.values(sfx).forEach(sound => playerGroup.add(sound));

  mixer = new THREE.AnimationMixer(robotModel);
  let clip = gltf.animations.find(c => /run|walk/i.test(c.name)) || gltf.animations[0];
  if (clip) {
    runAction = mixer.clipAction(clip);
    runAction.setLoop(THREE.LoopRepeat);
    runAction.play();
    runAction.paused = true;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ══════════════════════════════════════════════════════════════════════════════

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, clock.getDelta());

  if (mixer) mixer.update(delta);

  updatePhysics(delta);
  updateProjectiles(delta);
  tickParticles(delta);

  // Mouse move timeout
  if (mouseMoveTimer > 0) {
    mouseMoveTimer -= delta;
    if (mouseMoveTimer <= 0) isMouseMoving = false;
  }

  // Shield Reveal Logic
  if (shieldActive) {
    if (shieldReveal > 0) setShieldReveal(shieldReveal - delta * 2.5);
  } else {
    // Hidden
    setShieldReveal(1.0); 
  }
  updateShield(delta);

  // ── Robot Orientation & Servo Sound ─────────────────────────────────────
  if (robotModel) {
    const isMoving = playerVelocity.lengthSq() > 0.05;
    const curAngle = robotModel.rotation.y;
    let targetAngle = curAngle;

    if (isMoving) {
      const moveDir = new THREE.Vector3(playerVelocity.x, 0, playerVelocity.z).normalize();
      targetAngle = Math.atan2(moveDir.x, moveDir.z);
    } else {
      targetAngle = yaw;
    }

    const diff = ((targetAngle - curAngle + Math.PI) % (Math.PI * 2)) - Math.PI;
    const lerpFactor = isMoving ? (1 - Math.exp(-12 * delta)) : (1 - Math.exp(-8 * delta));
    robotModel.rotation.y += diff * lerpFactor;

    // Animation control
    if (runAction) {
      const isTurning = Math.abs(diff) > 0.05;
      if (playerOnFloor && (isMoving || isTurning)) {
        runAction.paused = false;
        const targetScale = isMoving ? (keys.shift ? 2.0 : 1.0) : 0.6; // Slower shuffle for turns
        runAction.setEffectiveTimeScale(targetScale);
        runAction.setEffectiveWeight(isMoving ? 1.0 : 0.5);
      } else {
        runAction.paused = true;
      }
    }

    // Servo sound: only when standing still and actually turning
    if (!isMoving && playerOnFloor && Math.abs(diff) > 0.01 && isMouseMoving) {
      if (!sfx.servo.isPlaying) sfx.servo.play();
    } else {
      if (sfx.servo.isPlaying) sfx.servo.stop();
    }
  }

  // ── Procedural bone poses ───────────────────────────────────────────────
  if (robotModel && robotBones.body) {
    robotBones.body.position.set(0, 0, 0);
    robotBones.body.rotation.set(0, 0, 0);
    robotBones.rootLegs.forEach(l => { l.position.set(0, 0, 0); l.rotation.set(0, 0, 0); });

    if (isJetpacking || !playerOnFloor) {
      // Common aerial dangling logic
      const horizontalVel = new THREE.Vector2(playerVelocity.x, playerVelocity.z);
      const speed = horizontalVel.length();
      
      // Kill animation influence to allow manual dangling
      if (runAction) runAction.setEffectiveWeight(0.0);

      // Lean body slightly based on movement
      robotBones.body.rotation.x = isJetpacking ? 0.3 : (speed * 0.02);
      
      // Vertical dangle swing (more pronounced)
      const swing = Math.sin(clock.elapsedTime * 3.0) * 0.12;
      const verticalDrag = Math.max(-0.7, Math.min(0.7, -playerVelocity.y * 0.05));
      
      robotBones.rootLegs.forEach((l, i) => {
        // Reset from any animation state first
        l.rotation.set(0, 0, 0);
        // Extend downwards & apply drag
        l.rotation.x = isJetpacking ? -0.5 : -0.3;
        l.rotation.x += verticalDrag + swing;
        
        // Sway opposite to movement direction (local space)
        l.rotation.z = (Math.cos(clock.elapsedTime * 2.0 + i) * 0.08); 
      });

      if (isJetpacking) {
        robotBones.body.position.y += Math.sin(clock.elapsedTime * 20) * 0.05; // Hover jitter
      }
    } else {
      if (runAction) runAction.setEffectiveWeight(1.0);
      if (keys.ctrl) {
        robotBones.body.position.y -= 0.7;
        robotBones.rootLegs.forEach((l, i) => {
          l.rotation.x += Math.sin(i) * 0.25;
          l.rotation.z -= 0.15;
        });
      }
    }
  }
  composer.render();
}

animate();