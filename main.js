import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, ExtendedTriangle } from 'three-mesh-bvh';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ─── BVH extensions ────────────────────────────────────────────────────────
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ─── Renderer ─────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.005);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
camera.layers.enable(1); // Projectiles / VFX
camera.layers.enable(2); // Player / Robot

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ─── Post Processing ──────────────────────────────────────────────────────
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 0.85);
bloomPass.threshold = 0.4;
bloomPass.strength = 0.6;
bloomPass.radius = 0.5;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ─── Static lights ─────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 4096;
dirLight.shadow.mapSize.height = 4096;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 500;
dirLight.shadow.camera.left = -100;
dirLight.shadow.camera.right = 100;
dirLight.shadow.camera.top = 100;
dirLight.shadow.camera.bottom = -100;
scene.add(dirLight);

// ─── Physics constants ─────────────────────────────────────────────────────
let environmentMesh = null;
const playerVelocity = new THREE.Vector3();
let playerOnFloor = false;
const GRAVITY = -30;
const SPEED = 3.5;
const JUMP_V = 10;
const CAP_HEIGHT = 1.0;
const CAP_RADIUS = 0.3;
const BASE_FOV = 75;

// ─── Player group ──────────────────────────────────────────────────────────
const playerGroup = new THREE.Group();
playerGroup.position.set(12, 0.2, -10); // Tactical floor-level spawn
scene.add(playerGroup);

// ─── Robot model & bones ───────────────────────────────────────────────────
let robotModel = null, mixer = null, runAction = null;
let muzzlePoint = null;
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
cameraRig.position.set(0, 0, 3.0);
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
  const light = new THREE.PointLight(0x00aaff, 0, 10);
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
  slot.light.color.setHSL(0.58 - charge * 0.42, 1.0, 0.6 + charge * 0.3);
  slot.dying = true;
  slot.decayRate = 6 + charge * 8;
}

// ─── Projectile meshes (shared geometry) ──────────────────────────────────
const projGeoSmall = new THREE.SphereGeometry(0.06, 8, 8);
const projGeoLarge = new THREE.SphereGeometry(0.24, 12, 12);
const projMatRapid = new THREE.MeshStandardMaterial({
  color: 0x00ccff, emissive: 0x00ccff, emissiveIntensity: 5,
  metalness: 1, roughness: 0, transparent: true, opacity: 0.9,
});
const projMatCharge = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0xff4400, emissiveIntensity: 10,
  metalness: 1, roughness: 0, transparent: true, opacity: 1.0,
});

const spriteMatRapid = new THREE.SpriteMaterial({
  map: buildParticleTexture(), color: 0x00ccff, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.8
});
const spriteMatCharge = new THREE.SpriteMaterial({
  map: buildParticleTexture(), color: 0xffaa00, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.9
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
    muzzleWorld.copy(playerGroup.position).add(new THREE.Vector3(0, 0.7, 0));
  }

  // Fire direction: camera forward
  const fireDir = _tempV2;
  camera.getWorldDirection(fireDir);

  const isCharged = charge > 0.15;
  const speed = isCharged ? (25 + charge * 35) : 55;
  const radius = isCharged ? (0.08 + charge * 0.22) : 0.06;

  proj.active = true;
  proj.charge = charge;
  proj.age = 0;
  proj.maxAge = isCharged ? 5.0 : 3.0;
  proj.radius = radius;
  proj.trailTimer = 0;
  proj.position.copy(muzzleWorld);
  // Push spawn point slightly ahead to clear robot geometry
  proj.position.addScaledVector(fireDir, 0.01);
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
  proj.glow.scale.setScalar(isCharged ? 1.5 : 0.6);

  // Small muzzle flash (particles)
  const flashCount = isCharged ? 30 : 10;
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
const MAX_CHARGE_TIME = 1.6;
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

const MAX_PARTICLES = 4000;
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
  const isCharged = proj.charge > 0.15;
  const rate = isCharged ? 0.016 : 0.028; // emit every N seconds
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

// Three.js Points object for rendering
const particleGeo = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
const colAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
const szAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
posAttr.setUsage(THREE.DynamicDrawUsage);
colAttr.setUsage(THREE.DynamicDrawUsage);
szAttr.setUsage(THREE.DynamicDrawUsage);
particleGeo.setAttribute('position', posAttr);
particleGeo.setAttribute('color', colAttr);
particleGeo.setAttribute('size', szAttr);
particleGeo.setDrawRange(0, MAX_PARTICLES);

const particleMat = new THREE.ShaderMaterial({
  uniforms: { uTex: { value: buildParticleTexture() } },
  vertexShader: `
    attribute float size;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vColor = color;
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (380.0 / -mvPos.z);
      gl_Position  = projectionMatrix * mvPos;
      vAlpha = clamp(size * 8.0, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D uTex;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float a = texture2D(uTex, gl_PointCoord).r;
      gl_FragColor = vec4(vColor * 1.8, a * vAlpha);
    }
  `,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  transparent: true,
  vertexColors: true,
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
    szAttr.array[i] = pData[d + 8] * life * life; // quadratic fade-out

    liveCount++;
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  szAttr.needsUpdate = true;
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
function handleImpact(position, normal, charge) {
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
      const mw = _tempV1;
      if (muzzlePoint) {
        muzzlePoint.getWorldPosition(mw);
        emitChargeParticles(mw.x, mw.y, mw.z, chargeT);
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
    proj.velocity.y += GRAVITY * 0.04 * delta;

    // Move
    proj.position.addScaledVector(proj.velocity, delta);

    // Sync light
    if (proj.lightSlot) {
      proj.lightSlot.light.position.copy(proj.position);
      // Pulse intensity slightly for life feel
      const pulse = 1 + Math.sin(proj.age * 18) * 0.15;
      proj.lightSlot.light.intensity = (proj.charge > 0.15
        ? (1.5 + proj.charge * 2.5)
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

      if (hits.length > 0) {
        const hit = hits[0];
        const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
        handleImpact(hit.point, normal, proj.charge);
        despawnProjectile(proj);
        continue;
      }
    }

    // ── Player self-hit guard (skip if within 0.5s of spawn) ──────────────
    if (proj.age > 0.5) {
      _capS.set(0, CAP_RADIUS, 0).add(playerGroup.position);
      _capE.set(0, CAP_HEIGHT + CAP_RADIUS, 0).add(playerGroup.position);
      if (pointInCapsule(proj.position, _capS, _capE, CAP_RADIUS + proj.radius)) {
        handleImpact(proj.position.clone(), new THREE.Vector3(0, 1, 0), proj.charge);
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

      const accel = playerOnFloor ? 35 : 12;
      playerVelocity.x += moveDir.x * accel * subDelta;
      playerVelocity.z += moveDir.z * accel * subDelta;

      if (s === 0 && robotModel) {
        const target = Math.atan2(moveDir.x, moveDir.z);
        let diff = target - robotModel.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        robotModel.rotation.y += diff * 15 * delta;
        if (runAction) { runAction.paused = false; runAction.setEffectiveTimeScale(animScale); }
      }
    } else if (s === 0 && runAction) {
      runAction.paused = true;
    }

    const friction = playerOnFloor ? 22 : 2.5;
    playerVelocity.x *= Math.max(0, 1 - friction * subDelta);
    playerVelocity.z *= Math.max(0, 1 - friction * subDelta);

    if (s === 0 && playerOnFloor && keys.space) playerVelocity.y = JUMP_V;

    playerVelocity.y += playerOnFloor ? 0 : GRAVITY * subDelta;
    playerGroup.position.addScaledVector(playerVelocity, subDelta);

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
    playerGroup.position.set(12, 0.2, -10);
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

loader.load('https://pub-a56d70d158b1414d83c3856ea210601c.r2.dev/vr__lazer_tag__paintball_arena.glb', gltf => {
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

  // ── Procedural bone poses ───────────────────────────────────────────────
  if (robotModel && robotBones.body) {
    robotBones.body.position.set(0, 0, 0);
    robotBones.body.rotation.set(0, 0, 0);
    robotBones.rootLegs.forEach(l => { l.position.set(0, 0, 0); l.rotation.set(0, 0, 0); });

    if (!playerOnFloor) {
      robotBones.body.position.y += 0.4;
      robotBones.rootLegs.forEach(l => { l.rotation.z += 0.5; });
      if (runAction) runAction.setEffectiveWeight(0.2);
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