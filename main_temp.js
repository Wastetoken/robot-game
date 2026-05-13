import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, ExtendedTriangle } from 'three-mesh-bvh';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { initShield, updateShield, updateShieldConfig, registerShieldHit, shieldGroup, shieldLife, setShieldLife, shieldReveal, setShieldReveal, shieldMesh } from './shield.js';

// â”€â”€â”€ BVH extensions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const CONTROL_STORAGE_KEY = 'orbRobotControls.v1';
const GAME_PARAMS = {
  scene: {
    background: '#b5f8ff',
    fogColor: '#e6d1b3',
    fogDensity: 0.01,
    exposure: 0.8,
    pixelRatio: Math.min(devicePixelRatio, 2),
    bloomThreshold: 0.9,
    bloomStrength: 0.2,
    bloomRadius: 0.05,
  },
  lighting: {
    ambientColor: '#ddeeff',
    ambientIntensity: 0.4,
    sunColor: '#fff4e0',
    sunIntensity: 1.2,
    sunX: 100,
    sunY: 150,
    sunZ: 100,
  },
  physics: {
    gravity: -30,
    speed: 5.5,
    sprintMultiplier: 1.8,
    groundAcceleration: 35,
    airAcceleration: 12,
    jumpVelocity: 10,
    jetpackForce: 40,
    maxJetVelocity: 8,
    frictionGround: 22,
    frictionAir: 2.5,
    physicsSubSteps: 8,
    capsuleHeight: 1.0,
    capsuleRadius: 0.3,
  },
  camera: {
    baseFOV: 75,
    chargeFOV: 68,
    mouseSensitivity: 0.002,
    pitchLimitPadding: 0.05,
    pivotHeight: 0.9,
    maxDistance: 3.0,
    minDistance: 0.5,
    wallPadding: 0.2,
    rotationSmooth: 24,
    collisionSmooth: 15,
  },
  combat: {
    chargeThreshold: 0.15,
    maxChargeTime: 1.0,
    rapidCooldown: 0.09,
    rapidSpeed: 10,
    chargedSpeedBase: 5,
    chargedSpeedBoost: 5,
    rapidRadius: 0.006,
    chargedRadiusBase: 0.008,
    chargedRadiusBoost: 0.32,
    rapidLifetime: 3.0,
    chargedLifetime: 5.0,
    rapidGlowScale: 0.15,
    chargedGlowScale: 1.15,
    chargeLightIntensity: 3,
    chargeLightDistance: 5,
    impactBaseCount: 120,
    impactChargeCount: 500,
  },
  projectile: {
    rapidColor: '#ffaa00',
    chargedColor: '#ffaa00',
    rapidEmissive: 5,
    chargedEmissive: 10,
    rapidOpacity: 0.9,
    chargedOpacity: 1.0,
    rapidLightIntensity: 0.6,
    chargedLightBase: 1,
    chargedLightBoost: 2,
    rapidLightDistance: 4,
    chargedLightDistanceBase: 4,
    chargedLightDistanceBoost: 8,
    pulseSpeed: 18,
    pulseAmount: 0.15,
    chargedMeshPulseSpeed: 20,
    chargedMeshPulseAmount: 0.1,
    chargedGlowPulseSpeed: 25,
    chargedGlowPulseAmount: 0.3,
  },
  jetpack: {
    flameHeight: 2.2,
    flameWidth: 1.0,
    flameTurbulence: 0.25,
    flameNoiseScale: 1.0,
    flameCoreSize: 0.25,
    coreColor: '#ff8c0d',
    midColor: '#1a73ff',
    lightningSpeed: 8.0,
    lightningChaos: 0.4,
    lightningDensity: 3.0,
    lightningArc: 0.6,
    lightningThickness: 0.08,
    lightningIntensity: 1.0,
    raymarchSteps: 64,
    raymarchPrecision: 0.02,
    glowPower: 4.0,
    colorBoost: 6.0,
    fadeInRate: 14.0,
    fadeOutRate: 5.0,
    positionOffsetY: -0.8,
    baseScale: 0.6,
    lightBaseIntensity: 20,
    lightRandomRange: 115,
    lightDistance: 6,
  },
  particles: {
    brightness: 15,
    gravityScale: 0.015,
    drag: 2.5,
    rapidTrailRate: 0.078,
    chargedTrailRate: 0.016,
    rapidTrailCount: 2,
    chargedTrailCountBase: 1,
    chargedTrailCountBoost: 4,
    jetpackParticleCount: 10,
    chargeParticleBase: 1,
    chargeParticleBoost: 3,
  },
  robot: {
    scale: 0.15,
    turnSmoothMoving: 12,
    turnSmoothIdle: 8,
    turnAnimationThreshold: 0.05,
    bodyAirLean: 0.02,
    bodyJetpackLean: 0.3,
    verticalDragAmount: 0.05,
    legDangle: -0.3,
    legJetpackDangle: -0.5,
    legSwingSpeed: 3,
    legSwingAmount: 0.12,
    legSwaySpeed: 2,
    legSwayAmount: 0.08,
    hoverJitterSpeed: 20,
    hoverJitterAmount: 0.05,
    crouchBodyDrop: 0.7,
  },
  shield: {
    radius: 0.7,
    posY: 0.7,
    color: '#26aeff',
    opacity: 0.76,
    showHex: true,
    hexScale: 10,
    hexOpacity: 0.13,
    edgeWidth: 0.06,
    fresnelPower: 1.8,
    fresnelStrength: 1.75,
    flowScale: 2.4,
    flowSpeed: 1.13,
    flowIntensity: 4,
    noiseScale: 1.3,
    noiseEdgeWidth: 0.02,
    noiseEdgeIntensity: 10,
    hitRingSpeed: 1.75,
    hitRingWidth: 0.12,
    hitIntensity: 4.1,
  },
  audio: {
    masterVolume: 1.0,
    walking: 0.4,
    running: 0.6,
    jetpack: 0.5,
    charge: 0.5,
    fire: 0.7,
    shield: 0.6,
    servo: 0.3,
  },
};

function mergeParams(target, source) {
  if (!source || typeof source !== 'object') return;
  Object.entries(source).forEach(([key, value]) => {
    if (!(key in target)) return;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object') {
      mergeParams(target[key], value);
    } else {
      target[key] = value;
    }
  });
}

try {
  mergeParams(GAME_PARAMS, JSON.parse(localStorage.getItem(CONTROL_STORAGE_KEY) || '{}'));
} catch (err) {
  console.warn('Could not load saved controls', err);
}

// â”€â”€â”€ Renderer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const scene = new THREE.Scene();
scene.background = new THREE.Color(GAME_PARAMS.scene.background);
scene.fog = new THREE.FogExp2(GAME_PARAMS.scene.fogColor, GAME_PARAMS.scene.fogDensity);

const camera = new THREE.PerspectiveCamera(GAME_PARAMS.camera.baseFOV, innerWidth / innerHeight, 0.1, 1000);
camera.layers.enable(1);
camera.layers.enable(2);

// â”€â”€â”€ Audio System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
renderer.setPixelRatio(GAME_PARAMS.scene.pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = GAME_PARAMS.scene.exposure;
document.body.appendChild(renderer.domElement);

// â”€â”€â”€ Post Processing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.4, 0.9);
bloomPass.threshold = GAME_PARAMS.scene.bloomThreshold;
bloomPass.strength = GAME_PARAMS.scene.bloomStrength;
bloomPass.radius = GAME_PARAMS.scene.bloomRadius;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// â”€â”€â”€ Lighting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ambientLight = new THREE.AmbientLight(GAME_PARAMS.lighting.ambientColor, GAME_PARAMS.lighting.ambientIntensity);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(GAME_PARAMS.lighting.sunColor, GAME_PARAMS.lighting.sunIntensity);
dirLight.position.set(GAME_PARAMS.lighting.sunX, GAME_PARAMS.lighting.sunY, GAME_PARAMS.lighting.sunZ);
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

// â”€â”€â”€ Physics constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let environmentMesh = null;
const playerVelocity = new THREE.Vector3();
let playerOnFloor = false;
const BASE_FOV = GAME_PARAMS.camera.baseFOV;

// â”€â”€â”€ Player group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const playerGroup = new THREE.Group();
playerGroup.position.set(-50.0, 1.5, 0.0);
scene.add(playerGroup);

// â”€â”€â”€ Robot model & bones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let robotModel = null, mixer = null, runAction = null;
let muzzlePoint = null;
let jetpackLight = null;
let isJetpacking = false;
let jetpackActive = false;
let shieldActive = false;
let isMouseMoving = false;
let mouseMoveTimer = 0;
const robotBones = { body: null, rootLegs: [] };

// â”€â”€â”€ Camera rig â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const cameraContainer = new THREE.Group();
scene.add(cameraContainer);

const cameraPivot = new THREE.Group();
cameraPivot.rotation.order = 'YXZ';
cameraContainer.add(cameraPivot);
cameraPivot.position.set(0, GAME_PARAMS.camera.pivotHeight, 0);

const cameraRig = new THREE.Group();
cameraPivot.add(cameraRig);
cameraRig.position.set(0, 0, GAME_PARAMS.camera.maxDistance);
cameraRig.add(camera);

// â”€â”€â”€ Input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      setShieldReveal(1.0);
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

// â”€â”€â”€ Pointer lock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  yaw -= (e.movementX || 0) * GAME_PARAMS.camera.mouseSensitivity;
  pitch -= (e.movementY || 0) * GAME_PARAMS.camera.mouseSensitivity;
  pitch = Math.max(
    -Math.PI / 2 + GAME_PARAMS.camera.pitchLimitPadding,
    Math.min(Math.PI / 2 - GAME_PARAMS.camera.pitchLimitPadding, pitch),
  );
  
  if (Math.abs(e.movementX) > 0.1 || Math.abs(e.movementY) > 0.1) {
    isMouseMoving = true;
    mouseMoveTimer = 0.1;
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PROJECTILE SYSTEM
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

const MAX_LIGHTS = 8;
const lightPool = Array.from({ length: MAX_LIGHTS }, () => {
  const light = new THREE.PointLight(0xFFAA00, 0, 60);
  light.castShadow = false;
  scene.add(light);
  return { light, dying: false, decayRate: 8, projectileId: -1 };
});

function acquireLight() {
  for (const s of lightPool) if (!s.dying && s.light.intensity === 0) return s;
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
  slot.light.color.setHSL(0.58 - charge * 1.42, 1.0, 0.6 + charge * 1.3);
  slot.dying = true;
  slot.decayRate = 6 + charge * 8;
}

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
  let proj = null;
  for (const p of projectiles) { if (!p.active) { proj = p; break; } }
  if (!proj) return;

  const muzzleWorld = _tempV1;
  if (muzzlePoint) {
    muzzlePoint.getWorldPosition(muzzleWorld);
  } else {
    muzzleWorld.copy(playerGroup.position).add(new THREE.Vector3(0, 0.07, 0));
  }

  const fireDir = _tempV2;
  camera.getWorldDirection(fireDir);

  const isCharged = charge > 0.15;
  const speed = isCharged
    ? (GAME_PARAMS.combat.chargedSpeedBase + charge * GAME_PARAMS.combat.chargedSpeedBoost)
    : GAME_PARAMS.combat.rapidSpeed;
  const radius = isCharged
    ? (GAME_PARAMS.combat.chargedRadiusBase + charge * GAME_PARAMS.combat.chargedRadiusBoost)
    : GAME_PARAMS.combat.rapidRadius;

  if (!isCharged && sfx.fire.buffer) {
    if (sfx.fire.isPlaying) sfx.fire.stop();
    sfx.fire.play();
  }

  proj.active = true;
  proj.charge = charge;
  proj.age = 0;
  proj.maxAge = isCharged ? GAME_PARAMS.combat.chargedLifetime : GAME_PARAMS.combat.rapidLifetime;
  proj.radius = radius;
  proj.trailTimer = 0;
  proj.position.copy(muzzleWorld);
  proj.position.addScaledVector(fireDir, 0.1);
  proj.prevPosition.copy(proj.position);
  proj.velocity.copy(fireDir).multiplyScalar(speed);

  if (!proj.mesh) {
    const geo = isCharged ? projGeoLarge : projGeoSmall;
    const mat = isCharged ? projMatCharge.clone() : projMatRapid.clone();
    proj.mesh = new THREE.Mesh(geo, mat);
    proj.mesh.name = 'projectile';
    proj.mesh.castShadow = false;
    proj.mesh.layers.set(1);
    scene.add(proj.mesh);
  } else {
    proj.mesh.visible = true;
  }
  proj.mesh.scale.setScalar(1);
  proj.mesh.position.copy(muzzleWorld);

  if (!proj.glow) {
    proj.glow = new THREE.Sprite(isCharged ? spriteMatCharge : spriteMatRapid);
    proj.glow.layers.set(1);
    scene.add(proj.glow);
  } else {
    proj.glow.visible = true;
  }
  proj.glow.scale.setScalar(isCharged ? GAME_PARAMS.combat.chargedGlowScale : GAME_PARAMS.combat.rapidGlowScale);

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

  const slot = acquireLight();
  slot.dying = false;
  slot.decayRate = 0;
  slot.projectileId = projectiles.indexOf(proj);
  slot.light.color.setHSL(isCharged ? 0.08 : 0.58, 1.0, 0.6);
  slot.light.intensity = isCharged
    ? (GAME_PARAMS.projectile.chargedLightBase + charge * GAME_PARAMS.projectile.chargedLightBoost)
    : GAME_PARAMS.projectile.rapidLightIntensity;
  slot.light.distance = isCharged
    ? (GAME_PARAMS.projectile.chargedLightDistanceBase + charge * GAME_PARAMS.projectile.chargedLightDistanceBoost)
    : GAME_PARAMS.projectile.rapidLightDistance;
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
  if (held >= GAME_PARAMS.combat.chargeThreshold) {
    const t = Math.min(held / GAME_PARAMS.combat.maxChargeTime, 1.0);
    spawnProjectile(t);
  }
  mouseDownTime = null;
  isCharging = false;
  chargeT = 0;
  if (sfx.charge && sfx.charge.isPlaying) sfx.charge.stop();
  camera.fov = GAME_PARAMS.camera.baseFOV;
  camera.updateProjectionMatrix();
  chargeLight.intensity = 0;
  chargeBar.style.display = 'none';
});

// â”€â”€â”€ Jetpack flame â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const jetpackFlameMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.BackSide,
  blending: THREE.AdditiveBlending,
  uniforms: {
    iTime:      { value: 0.0 },
    iIntensity: { value: 0.0 },
    iCameraPos: { value: new THREE.Vector3() },
    flameHeight:    { value: 2.2 },
    flameWidth:     { value: 1.0 },
    flameTurbulence:{ value: 0.25 },
    flameNoiseScale:{ value: 1.0 },
    flameCoreSize:  { value: 0.25 },
    coreColor:      { value: new THREE.Vector3(1.0, 0.55, 0.05) },
    midColor:       { value: new THREE.Vector3(0.1, 0.45, 1.0) },
    lightningSpeed: { value: 8.0 },
    lightningChaos: { value: 0.4 },
    lightningDensity:{ value: 3.0 },
    lightningArc:    { value: 0.6 },
    lightningThickness:{ value: 0.08 },
    lightningIntensity:{ value: 1.0 },
    raymarchSteps:  { value: 64 },
    raymarchPrecision:{ value: 0.02 },
    glowPower:       { value: 4.0 },
    colorBoost:      { value: 6.0 },
  },
  vertexShader: `
    varying vec3 vLocalPos;
    void main() {
      vLocalPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float iTime;
    uniform float iIntensity;
    uniform vec3  iCameraPos;
    varying vec3  vLocalPos;
    uniform float flameHeight;
    uniform float flameWidth;
    uniform float flameTurbulence;
    uniform float flameNoiseScale;
    uniform float flameCoreSize;
    uniform vec3 coreColor;
    uniform vec3 midColor;
    uniform float lightningSpeed;
    uniform float lightningChaos;
    uniform float lightningDensity;
    uniform float lightningArc;
    uniform float lightningThickness;
    uniform float lightningIntensity;
    uniform float raymarchSteps;
    uniform float raymarchPrecision;
    uniform float glowPower;
    uniform float colorBoost;

    float noise(vec3 p) {
      vec3 i = floor(p);
      vec4 a = dot(i, vec3(1.0, 57.0, 21.0)) + vec4(0.0, 57.0, 21.0, 78.0);
      vec3 f = cos((p - i) * acos(-1.0)) * (-0.5) + 0.5;
      a = mix(sin(cos(a)*a), sin(cos(1.0+a)*(1.0+a)), f.x);
      a.xy = mix(a.xz, a.yw, f.y);
      return mix(a.x, a.y, f.z);
    }

    float lightning(vec3 p) {
      float lightning = 1000.0;
      float mainBolt = length(p.xz * vec2(flameWidth, flameWidth)) - lightningThickness;
      lightning = min(lightning, mainBolt);
      float timePhase = fract(iTime * lightningSpeed * 0.1);
      float chaosOffset = noise(p * 10.0 + iTime) * lightningChaos;
      for (float i = 0.0; i < lightningDensity; i++) {
        float branchAngle = (i / lightningDensity) * 3.14159 * 2.0;
        float arcOffset = sin(timePhase * 6.28318 + i) * lightningArc;
        vec3 branchPos = p;
        branchPos.x += cos(branchAngle) * (flameCoreSize + arcOffset) + chaosOffset;
        branchPos.z += sin(branchAngle) * (flameCoreSize + arcOffset) + chaosOffset;
        float branchThickness = lightningThickness * (1.0 - i / lightningDensity * 0.5);
        float branch = length(branchPos.xz) - branchThickness;
        branch += abs(sin(p.y * 4.0 + timePhase * 10.0 + i)) * 0.02;
        lightning = min(lightning, branch);
      }
      if (fract(timePhase * 2.0) < 0.3) {
        for (float j = 0.0; j < 2.0; j++) {
          vec2 chaosDir = normalize(vec2(
            sin(timePhase * 15.0 + j * 3.0),
            cos(timePhase * 12.0 + j * 2.0)
          )) * lightningChaos;
          vec3 boltPos = p;
          boltPos.xz += chaosDir;
          float bolt = length(boltPos.xz) - lightningThickness * 0.5;
          lightning = min(lightning, bolt);
        }
      }
      return lightning;
    }

    float flame(vec3 p) {
      float d = length(p * vec3(flameWidth, flameCoreSize, flameWidth)) - 1.0;
      float flameNoise = (noise(p * flameNoiseScale) + noise(p * 3.0 * flameNoiseScale) * 0.5) * flameTurbulence * (p.y + 1.0);
      float lightningEffect = lightning(p);
      if (lightningEffect < raymarchPrecision) {
        return d + flameNoise - 0.1 * lightningIntensity;
      }
      return d + flameNoise;
    }

    void main() {
      vec3 ro = iCameraPos;
      vec3 rd = normalize(vLocalPos - iCameraPos);
      float glow = 0.0;
      float d    = 0.0;
      vec3  p    = ro;
      bool  inside = false;
      for (int i = 0; i < int(raymarchSteps); i++) {
        d = flame(p) + raymarchPrecision;
        p += d * rd;
        if (length(p) > 2.5) break;
        if (d > raymarchPrecision) {
          if (flame(p) < 0.0) inside = true;
          if (inside) glow = float(i) / raymarchSteps;
        }
      }
      if (glow < 0.001) discard;
      vec4 col = mix(
        vec4(coreColor, 1.0),
        vec4(midColor, 1.0),
        clamp(p.y * 0.5 + 0.5, 0.0, 1.0)
      );
      float lightningEffect = lightning(p);
      if (lightningEffect < raymarchPrecision) {
        col = mix(col, vec4(0.8, 0.9, 1.0, 1.0), 0.8 * lightningIntensity);
      }
      vec4 fragColor = mix(vec4(0.0), col, pow(glow * 2.0, glowPower));
      gl_FragColor   = vec4(fragColor.rgb * colorBoost, fragColor.a * iIntensity);
    }
  `
});

const jetpackFlameGeo  = new THREE.SphereGeometry(1.0, 0.2, 1.0);
jetpackFlameGeo.applyMatrix4(new THREE.Matrix4().makeScale(3.0, 5.2, 3.0));

const jetpackFlameMesh = new THREE.Mesh(jetpackFlameGeo, jetpackFlameMat);
jetpackFlameMesh.visible       = false;
jetpackFlameMesh.frustumCulled = false;
jetpackFlameMesh.layers.set(1);
scene.add(jetpackFlameMesh);

function updateJetpackFlame(delta) {
  jetpackFlameMat.uniforms.iTime.value += delta;

  const u      = jetpackFlameMat.uniforms.iIntensity;
  const target = jetpackActive ? 1.0 : 0.0;
  const rate   = jetpackActive ? GAME_PARAMS.jetpack.fadeInRate : GAME_PARAMS.jetpack.fadeOutRate;
  u.value += (target - u.value) * (1 - Math.exp(-rate * delta));

  jetpackFlameMesh.visible = u.value > 0.01;
  if (!jetpackFlameMesh.visible) return;

  jetpackFlameMesh.position.copy(playerGroup.position);
  jetpackFlameMesh.position.y += GAME_PARAMS.jetpack.positionOffsetY;

  const localCam = jetpackFlameMesh.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
  jetpackFlameMat.uniforms.iCameraPos.value.copy(localCam);

  jetpackFlameMesh.scale.setScalar(GAME_PARAMS.jetpack.baseScale * u.value);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PARTICLE SYSTEM
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const MAX_PARTICLES = 16000;
const PARTICLE_STRIDE = 9;

const pPos = new Float32Array(MAX_PARTICLES * 3);
const pData = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
const pColor = new Float32Array(MAX_PARTICLES * 3);
const pSize = new Float32Array(MAX_PARTICLES);
let pHead = 0;

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
  const rate = isCharged ? GAME_PARAMS.particles.chargedTrailRate : GAME_PARAMS.particles.rapidTrailRate;
  proj.trailTimer += 0.016;
  if (proj.trailTimer < rate) return;
  proj.trailTimer = 0;

  const count = isCharged
    ? Math.ceil(GAME_PARAMS.particles.chargedTrailCountBase + proj.charge * GAME_PARAMS.particles.chargedTrailCountBoost)
    : GAME_PARAMS.particles.rapidTrailCount;
  for (let k = 0; k < count; k++) {
    const spread = isCharged ? 0.08 : 0.03;
    emitParticle(
      proj.position.x + (Math.random() - 0.5) * spread,
      proj.position.y + (Math.random() - 0.5) * spread,
      proj.position.z + (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.4 + 0.3,
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
  const count = Math.floor(GAME_PARAMS.combat.impactBaseCount + charge * GAME_PARAMS.combat.impactChargeCount);
  for (let k = 0; k < count; k++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const spd = 1.5 + Math.random() * (3 + charge * 8);
    const vx = Math.sin(phi) * Math.cos(theta) * spd + nx * spd * 0.4;
    const vy = Math.cos(phi) * spd + ny * spd * 0.4;
    const vz = Math.sin(phi) * Math.sin(theta) * spd + nz * spd * 0.4;
    const life = 0.3 + Math.random() * (0.5 + charge * 0.6);
    const size = 0.04 + Math.random() * (0.08 + charge * 0.14);
    const t = Math.random();
    const r = 1.0;
    const g = t < 0.4 ? 0.6 + t * 0.8 : 0.2;
    const b = t < 0.4 ? 0.1 : t;
    emitParticle(px, py, pz, vx, vy, vz, 0, life, size, r, g, b);
  }
}

function emitChargeParticles(px, py, pz, charge) {
  const count = Math.floor(GAME_PARAMS.particles.chargeParticleBase + charge * GAME_PARAMS.particles.chargeParticleBoost);
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
      vx * -0.3, vy, vz * -0.3,
      0, 0.25 + charge * 0.2,
      0.05 + charge * 0.12,
      0.4, 0.8 + charge * 0.2, 1.0,
    );
  }
}

function emitJetpackParticles(px, py, pz, vx, vy, vz) {
  const count = GAME_PARAMS.particles.jetpackParticleCount;
  for (let k = 0; k < count; k++) {
    const spread = 0.4;
    const lifeCore = 0.1 + Math.random() * 0.2;
    const sizeCore = 0.2 + Math.random() * 0.3;
    emitParticle(
      px + (Math.random() - 0.5) * spread, py, pz + (Math.random() - 0.5) * spread,
      vx + (Math.random() - 0.5) * 2.0, vy - 18.0 - Math.random() * 10.0, vz + (Math.random() - 0.5) * 2.0,
      0, lifeCore, sizeCore, 0.6, 0.9, 1.0
    );
    const lifeBloom = 0.3 + Math.random() * 0.3;
    const sizeBloom = 0.5 + Math.random() * 0.6;
    emitParticle(
      px + (Math.random() - 0.5) * 0.5, py, pz + (Math.random() - 0.5) * 0.5,
      vx * 0.8 + (Math.random() - 0.5) * 3.0, vy * 0.5 - 10.0 - Math.random() * 5.0, vz * 0.8 + (Math.random() - 0.5) * 3.0,
      0, lifeBloom, sizeBloom, 0.1, 0.5, 1.0
    );
    if (k % 3 === 0) {
      emitParticle(
        px, py, pz,
        vx + (Math.random() - 0.5) * 10.0, vy - 5.0 - Math.random() * 20.0, vz + (Math.random() - 0.5) * 10.0,
        0, 0.15, 0.15, 1.0, 1.0, 1.0
      );
    }
  }
}

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
    uTex: { value: buildParticleTexture() },
    uBrightness: { value: GAME_PARAMS.particles.brightness }
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
    uniform float uBrightness;
    varying float vLife;
    varying vec3 vColor;
    void main() {
      float a = texture2D(uTex, gl_PointCoord).r;
      gl_FragColor = vec4(vColor * uBrightness, vLife * a);
    }
  `
});

const particleMesh = new THREE.Points(particleGeo, particleMat);
particleMesh.layers.set(1);
particleMesh.frustumCulled = false;
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
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const d = i * PARTICLE_STRIDE;
    let age = pData[d + 6];
    const maxA = pData[d + 7];
    if (age >= maxA) {
      szAttr.array[i] = 0;
      continue;
    }
    age += delta;
    pData[d + 6] = age;
    pData[d + 3] *= (1 - delta * GAME_PARAMS.particles.drag);
    pData[d + 4] += GAME_PARAMS.physics.gravity * GAME_PARAMS.particles.gravityScale * delta;
    pData[d + 5] *= (1 - delta * GAME_PARAMS.particles.drag);
    pData[d + 0] += pData[d + 3] * delta;
    pData[d + 1] += pData[d + 4] * delta;
    pData[d + 2] += pData[d + 5] * delta;
    const t = age / maxA;
    const life = 1 - t;
    posAttr.array[i * 3 + 0] = pData[d + 0];
    posAttr.array[i * 3 + 1] = pData[d + 1];
    posAttr.array[i * 3 + 2] = pData[d + 2];
    colAttr.array[i * 3 + 0] = pColor[i * 3 + 0];
    colAttr.array[i * 3 + 1] = pColor[i * 3 + 1];
    colAttr.array[i * 3 + 2] = pColor[i * 3 + 2];
    szAttr.array[i] = pData[d + 8];
    lifeAttr.array[i] = life * life;
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  szAttr.needsUpdate = true;
  lifeAttr.needsUpdate = true;
}

// â”€â”€â”€ Charge light â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const chargeLight = new THREE.PointLight(0x00ffff, 0, 4);
chargeLight.castShadow = false;
playerGroup.add(chargeLight);
chargeLight.position.set(0.3, 0.7, -0.5);

// â”€â”€â”€ Collision helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _closestPt = new THREE.Vector3();
const _chkSeg = new THREE.Line3();
const _tempMat = new THREE.Matrix4();  // FIX: was missing, caused ReferenceError
const _tempV1 = new THREE.Vector3();
const _tempV2 = new THREE.Vector3();
const _tempV3 = new THREE.Vector3();

function pointInCapsule(point, capStart, capEnd, radius) {
  _chkSeg.set(capStart, capEnd);
  _chkSeg.closestPointToPoint(point, true, _closestPt);
  return point.distanceToSquared(_closestPt) < radius * radius;
}

function handleImpact(position, normal, charge, targetObj = null) {
  if (shieldActive && (targetObj === shieldMesh || (targetObj && targetObj.layers.isEnabled(2)))) {
    registerShieldHit(position);
    const damage = charge > 0.5 ? 0.25 : 0.08;
    setShieldLife(shieldLife - damage);
    flashImpactLight(position, charge * 0.5);
    return true;
  }
  flashImpactLight(position, charge);
  emitImpactBurst(
    position.x, position.y, position.z,
    normal.x, normal.y, normal.z,
    charge,
  );
}

const _pRayDir = new THREE.Vector3();
const _pRay = new THREE.Raycaster();
const _capS = new THREE.Vector3();
const _capE = new THREE.Vector3();

function updateProjectiles(delta) {
  if (mouseDownTime !== null) {
    const held = clock.getElapsedTime() - mouseDownTime;
    if (held < GAME_PARAMS.combat.chargeThreshold) {
      rapidFireTimer -= delta;
      if (rapidFireTimer <= 0) {
        spawnProjectile(0);
        rapidFireTimer = GAME_PARAMS.combat.rapidCooldown;
      }
      chargeLight.intensity = 0;
      chargeBar.style.display = 'none';
    } else {
      isCharging = true;
      chargeT = Math.min(held / GAME_PARAMS.combat.maxChargeTime, 1.0);

      if (sfx.charge.buffer && !sfx.charge.isPlaying) {
        sfx.charge.play();
      }

      chargeBar.style.display = 'block';
      chargeFill.style.width = (chargeT * 100) + '%';
      chargeFill.style.background = chargeT > 0.8 ? '#fff' : `linear-gradient(90deg, #ff4d4d, #ffcc00)`;

      chargeLight.intensity = chargeT * GAME_PARAMS.combat.chargeLightIntensity;
      chargeLight.distance = 1 + chargeT * GAME_PARAMS.combat.chargeLightDistance;
      chargeLight.color.setHSL(0.5 - chargeT * 0.08, 1, 0.6);

      camera.fov = THREE.MathUtils.lerp(GAME_PARAMS.camera.baseFOV, GAME_PARAMS.camera.chargeFOV, chargeT);
      camera.updateProjectionMatrix();

      if (muzzlePoint) {
        const mw = _tempV1;
        muzzlePoint.getWorldPosition(mw);
        emitChargeParticles(mw.x, mw.y, mw.z, chargeT);
      }

      if (chargeT >= 1.0) {
        spawnProjectile(1.0);
        mouseDownTime = null;
        isCharging = false;
        if (sfx.charge && sfx.charge.isPlaying) sfx.charge.stop();
        chargeLight.intensity = 0;
        chargeBar.style.display = 'none';
        camera.fov = GAME_PARAMS.camera.baseFOV;
        camera.updateProjectionMatrix();
      }
    }
  }

  for (let pi = 0; pi < projectiles.length; pi++) {
    const proj = projectiles[pi];
    if (!proj.active) continue;

    proj.age += delta;
    if (proj.age > proj.maxAge) { despawnProjectile(proj); continue; }

    proj.prevPosition.copy(proj.position);
    proj.velocity.y += GAME_PARAMS.physics.gravity * 0.0009 * delta;
    proj.position.addScaledVector(proj.velocity, delta);

    if (proj.lightSlot) {
      proj.lightSlot.light.position.copy(proj.position);
      const pulse = 1 + Math.sin(proj.age * 18) * 0.15;
      proj.lightSlot.light.intensity = (proj.charge > 0.15
        ? (1.5 + proj.charge * 1.5)
        : 1.0) * pulse;
    }

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

    emitTrailParticles(proj);

    if (environmentMesh) {
      const sweepOrigin = proj.prevPosition.clone();
      const sweepDir = new THREE.Vector3().subVectors(proj.position, proj.prevPosition);
      const sweepDist = sweepDir.length();
      sweepDir.normalize();

      const ray = new THREE.Raycaster(sweepOrigin, sweepDir, 0, sweepDist + proj.radius + 0.1);
      ray.layers.set(0);
      const hits = ray.intersectObject(environmentMesh, true);

      let shieldHit = null;
      if (shieldActive && shieldMesh) {
        const sHits = ray.intersectObject(shieldMesh);
        if (sHits.length > 0) {
          const sHit = sHits[0];
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

    if (proj.age > 0.5) {
      _capS.set(0, GAME_PARAMS.physics.capsuleRadius, 0).add(playerGroup.position);
      _capE.set(0, GAME_PARAMS.physics.capsuleHeight + GAME_PARAMS.physics.capsuleRadius, 0).add(playerGroup.position);
      if (pointInCapsule(proj.position, _capS, _capE, GAME_PARAMS.physics.capsuleRadius + proj.radius)) {
        handleImpact(proj.position.clone(), new THREE.Vector3(0, 1, 0), proj.charge, playerGroup);
        despawnProjectile(proj);
        continue;
      }
    }
  }

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

  for (const slot of lightPool) {
    if (!slot.dying) continue;
    slot.light.intensity *= Math.exp(-slot.decayRate * delta);
    if (slot.light.intensity < 0.01) {
      slot.light.intensity = 0;
      slot.dying = false;
    }
  }
}

function updatePhysics(delta) {
  // FIX: guard against null before environment loads
  if (!environmentMesh) return;

  const physicsSubSteps = Math.max(1, Math.round(GAME_PARAMS.physics.physicsSubSteps));
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

      const accelBase = playerOnFloor ? GAME_PARAMS.physics.groundAcceleration : GAME_PARAMS.physics.airAcceleration;
      const sprintMultiplier = keys.shift ? GAME_PARAMS.physics.sprintMultiplier : 1.0;
      const accel = accelBase * sprintMultiplier;

      playerVelocity.x += moveDir.x * accel * subDelta;
      playerVelocity.z += moveDir.z * accel * subDelta;
    }

    const friction = playerOnFloor ? GAME_PARAMS.physics.frictionGround : GAME_PARAMS.physics.frictionAir;
    playerVelocity.x *= Math.max(0, 1 - friction * subDelta);
    playerVelocity.z *= Math.max(0, 1 - friction * subDelta);

    if (s === 0 && playerOnFloor && keys.space) playerVelocity.y = GAME_PARAMS.physics.jumpVelocity;

    playerVelocity.y += playerOnFloor ? 0 : GAME_PARAMS.physics.gravity * subDelta;

    isJetpacking = !playerOnFloor && keys.space && playerVelocity.y < GAME_PARAMS.physics.maxJetVelocity;
    jetpackActive = !playerOnFloor && keys.space;
    if (isJetpacking) {
      playerVelocity.y += GAME_PARAMS.physics.jetpackForce * subDelta;
      if (s === 0) {
        if (jetpackLight) {
          jetpackLight.intensity = GAME_PARAMS.jetpack.lightBaseIntensity + Math.random() * GAME_PARAMS.jetpack.lightRandomRange;
          jetpackLight.position.copy(playerGroup.position).y += 0.0006;
        }
      }
    } else if (s === 0 && jetpackLight) {
      jetpackLight.intensity = 0;
    }

    playerGroup.position.addScaledVector(playerVelocity, subDelta);

    if (s === 0) {
      const isMoving = Math.abs(moveDir.x) > 0.1 || Math.abs(moveDir.z) > 0.1;

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

      if (isJetpacking) {
        if (!sfx.jetpack.isPlaying) sfx.jetpack.play();
      } else {
        if (sfx.jetpack.isPlaying) sfx.jetpack.stop();
      }
    }

    const crouchH = keys.ctrl ? GAME_PARAMS.physics.capsuleHeight * 0.6 : GAME_PARAMS.physics.capsuleHeight;
    const capsuleStart = new THREE.Vector3(0, GAME_PARAMS.physics.capsuleRadius, 0).add(playerGroup.position);
    const capsuleEnd = new THREE.Vector3(0, crouchH + GAME_PARAMS.physics.capsuleRadius, 0).add(playerGroup.position);

    playerOnFloor = false;

    environmentMesh.traverse(child => {
      if (!child.isMesh || !child.geometry.boundsTree) return;
      if (child.layers.isEnabled(2)) return;

      _tempMat.copy(child.matrixWorld).invert();
      const localS = new THREE.Vector3().copy(capsuleStart).applyMatrix4(_tempMat);
      const localE = new THREE.Vector3().copy(capsuleEnd).applyMatrix4(_tempMat);
      const localLine = new THREE.Line3(localS, localE);

      const localCenter = new THREE.Vector3().addVectors(localS, localE).multiplyScalar(0.5);
      const localRadius = localS.distanceTo(localE) * 0.5 + GAME_PARAMS.physics.capsuleRadius;
      const localSphere = new THREE.Sphere(localCenter, localRadius);

      child.geometry.boundsTree.shapecast({
        intersectsBounds: box => box.intersectsSphere(localSphere),
        intersectsTriangle: tri => {
          const dist = tri.closestPointToSegment(localLine, _tempV1, _tempV2);
          if (dist < GAME_PARAMS.physics.capsuleRadius) {
            const normalLocal = _tempV3.subVectors(_tempV2, _tempV1).normalize();
            const normalWorld = normalLocal.transformDirection(child.matrixWorld);
            const overlap = GAME_PARAMS.physics.capsuleRadius - dist;

            playerGroup.position.addScaledVector(normalWorld, overlap);

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

  if (!playerOnFloor && playerVelocity.y <= 0 && environmentMesh) {
    const rayOrigin = playerGroup.position.clone().add(new THREE.Vector3(0, 1, 0));
    const snapRay = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 1.2);
    snapRay.layers.set(0);
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

  const camAlpha = 1 - Math.exp(-GAME_PARAMS.camera.rotationSmooth * delta);
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
  const camCaster = new THREE.Raycaster(pivotW, camDir, 0.05, GAME_PARAMS.camera.maxDistance);
  camCaster.layers.set(0);
  const camHits = environmentMesh ? camCaster.intersectObject(environmentMesh, true) : [];
  const targetZ = camHits.length > 0
    ? Math.max(GAME_PARAMS.camera.minDistance, camHits[0].distance - GAME_PARAMS.camera.wallPadding)
    : GAME_PARAMS.camera.maxDistance;
  cameraRig.position.z += (targetZ - cameraRig.position.z) * (1 - Math.exp(-GAME_PARAMS.camera.collisionSmooth * delta));
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ASSET LOADING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function colorToVec3(hex) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

function setMatColor(mat, color, emissiveIntensity, opacity) {
  mat.color.set(color);
  mat.emissive.set(color);
  mat.emissiveIntensity = emissiveIntensity;
  mat.opacity = opacity;
}

function updateJetpackUniforms() {
  const u = jetpackFlameMat.uniforms;
  u.flameHeight.value = GAME_PARAMS.jetpack.flameHeight;
  u.flameWidth.value = GAME_PARAMS.jetpack.flameWidth;
  u.flameTurbulence.value = GAME_PARAMS.jetpack.flameTurbulence;
  u.flameNoiseScale.value = GAME_PARAMS.jetpack.flameNoiseScale;
  u.flameCoreSize.value = GAME_PARAMS.jetpack.flameCoreSize;
  u.coreColor.value.copy(colorToVec3(GAME_PARAMS.jetpack.coreColor));
  u.midColor.value.copy(colorToVec3(GAME_PARAMS.jetpack.midColor));
  u.lightningSpeed.value = GAME_PARAMS.jetpack.lightningSpeed;
  u.lightningChaos.value = GAME_PARAMS.jetpack.lightningChaos;
  u.lightningDensity.value = GAME_PARAMS.jetpack.lightningDensity;
  u.lightningArc.value = GAME_PARAMS.jetpack.lightningArc;
  u.lightningThickness.value = GAME_PARAMS.jetpack.lightningThickness;
  u.lightningIntensity.value = GAME_PARAMS.jetpack.lightningIntensity;
  u.raymarchSteps.value = GAME_PARAMS.jetpack.raymarchSteps;
  u.raymarchPrecision.value = GAME_PARAMS.jetpack.raymarchPrecision;
  u.glowPower.value = GAME_PARAMS.jetpack.glowPower;
  u.colorBoost.value = GAME_PARAMS.jetpack.colorBoost;
}

function updateAudioVolumes() {
  Object.entries(sfx).forEach(([name, sound]) => {
    if (GAME_PARAMS.audio[name] == null) return;
    sound.setVolume(GAME_PARAMS.audio[name] * GAME_PARAMS.audio.masterVolume);
  });
}

function applyGameParams() {
  scene.background.set(GAME_PARAMS.scene.background);
  scene.fog.color.set(GAME_PARAMS.scene.fogColor);
  scene.fog.density = GAME_PARAMS.scene.fogDensity;
  renderer.toneMappingExposure = GAME_PARAMS.scene.exposure;
  renderer.setPixelRatio(GAME_PARAMS.scene.pixelRatio);
  bloomPass.threshold = GAME_PARAMS.scene.bloomThreshold;
  bloomPass.strength = GAME_PARAMS.scene.bloomStrength;
  bloomPass.radius = GAME_PARAMS.scene.bloomRadius;
  ambientLight.color.set(GAME_PARAMS.lighting.ambientColor);
  ambientLight.intensity = GAME_PARAMS.lighting.ambientIntensity;
  dirLight.color.set(GAME_PARAMS.lighting.sunColor);
  dirLight.intensity = GAME_PARAMS.lighting.sunIntensity;
  dirLight.position.set(GAME_PARAMS.lighting.sunX, GAME_PARAMS.lighting.sunY, GAME_PARAMS.lighting.sunZ);
  if (!isCharging) camera.fov = GAME_PARAMS.camera.baseFOV;
  camera.updateProjectionMatrix();
  cameraPivot.position.y = GAME_PARAMS.camera.pivotHeight;
  setMatColor(projMatRapid, GAME_PARAMS.projectile.rapidColor, GAME_PARAMS.projectile.rapidEmissive, GAME_PARAMS.projectile.rapidOpacity);
  setMatColor(projMatCharge, GAME_PARAMS.projectile.chargedColor, GAME_PARAMS.projectile.chargedEmissive, GAME_PARAMS.projectile.chargedOpacity);
  spriteMatRapid.color.set(GAME_PARAMS.projectile.rapidColor);
  spriteMatRapid.opacity = GAME_PARAMS.projectile.rapidOpacity;
  spriteMatCharge.color.set(GAME_PARAMS.projectile.chargedColor);
  spriteMatCharge.opacity = GAME_PARAMS.projectile.chargedOpacity;
  particleMat.uniforms.uBrightness.value = GAME_PARAMS.particles.brightness;
  updateJetpackUniforms();
  if (robotModel) robotModel.scale.setScalar(GAME_PARAMS.robot.scale);
  if (jetpackLight) jetpackLight.distance = GAME_PARAMS.jetpack.lightDistance;
  updateShieldConfig(GAME_PARAMS.shield);
  updateAudioVolumes();
}

function createControlPanel() {
  const panel = document.createElement('aside');
  panel.id = 'control-panel';
  panel.innerHTML = '<div class="control-panel-header"><strong>Look Controls</strong><button type="button" data-action="toggle">Hide</button></div><div class="control-panel-body"></div><div class="control-panel-actions"><button type="button" data-action="save">Save</button><button type="button" data-action="reset">Reset</button></div>';
  document.body.appendChild(panel);
  const body = panel.querySelector('.control-panel-body');
  const groups = {
    Scene: [
      ['scene.background', 'color', 'Sky'], ['scene.fogColor', 'color', 'Fog'], ['scene.fogDensity', 'range', 'Fog density', 0, 0.08, 0.001],
      ['scene.exposure', 'range', 'Exposure', 0.1, 2.5, 0.01], ['scene.bloomStrength', 'range', 'Bloom strength', 0, 3, 0.01], ['scene.bloomRadius', 'range', 'Bloom radius', 0, 1, 0.01],
    ],
    Lighting: [
      ['lighting.ambientColor', 'color', 'Ambient'], ['lighting.ambientIntensity', 'range', 'Ambient intensity', 0, 3, 0.01], ['lighting.sunColor', 'color', 'Sun'],
      ['lighting.sunIntensity', 'range', 'Sun intensity', 0, 5, 0.01], ['lighting.sunX', 'range', 'Sun X', -300, 300, 1], ['lighting.sunY', 'range', 'Sun Y', 0, 400, 1], ['lighting.sunZ', 'range', 'Sun Z', -300, 300, 1],
    ],
    Camera: [
      ['camera.baseFOV', 'range', 'Base FOV', 45, 110, 1], ['camera.chargeFOV', 'range', 'Charge FOV', 45, 110, 1], ['camera.mouseSensitivity', 'range', 'Mouse sensitivity', 0.0005, 0.008, 0.0001],
      ['camera.pivotHeight', 'range', 'Camera height', 0.2, 2.5, 0.01], ['camera.maxDistance', 'range', 'Camera distance', 1, 8, 0.05], ['camera.rotationSmooth', 'range', 'Rotation smooth', 1, 60, 1],
    ],
    Movement: [
      ['physics.gravity', 'range', 'Gravity', -80, -1, 1], ['physics.groundAcceleration', 'range', 'Ground accel', 1, 80, 1], ['physics.airAcceleration', 'range', 'Air accel', 1, 50, 1],
      ['physics.sprintMultiplier', 'range', 'Sprint multiplier', 1, 4, 0.05], ['physics.jumpVelocity', 'range', 'Jump velocity', 1, 25, 0.1], ['physics.jetpackForce', 'range', 'Jetpack force', 1, 100, 1],
      ['physics.maxJetVelocity', 'range', 'Max jet velocity', 1, 30, 0.1], ['physics.frictionGround', 'range', 'Ground friction', 0, 60, 1], ['physics.frictionAir', 'range', 'Air friction', 0, 20, 0.1],
    ],
    Projectiles: [
      ['projectile.rapidColor', 'color', 'Rapid color'], ['projectile.chargedColor', 'color', 'Charged color'], ['combat.rapidSpeed', 'range', 'Rapid speed', 1, 80, 1],
      ['combat.chargedSpeedBase', 'range', 'Charged speed base', 1, 80, 1], ['combat.chargedSpeedBoost', 'range', 'Charged speed boost', 0, 80, 1], ['combat.rapidRadius', 'range', 'Rapid radius', 0.001, 0.08, 0.001],
      ['combat.chargedRadiusBoost', 'range', 'Charged radius boost', 0.02, 1, 0.01], ['projectile.rapidEmissive', 'range', 'Rapid emissive', 0, 30, 0.1], ['projectile.chargedEmissive', 'range', 'Charged emissive', 0, 40, 0.1],
      ['combat.rapidCooldown', 'range', 'Rapid cooldown', 0.02, 0.5, 0.01], ['combat.impactBaseCount', 'range', 'Impact particles', 0, 800, 10], ['combat.impactChargeCount', 'range', 'Charged impact boost', 0, 1600, 10],
    ],
    Jetpack: [
      ['jetpack.coreColor', 'color', 'Core color'], ['jetpack.midColor', 'color', 'Outer color'], ['jetpack.flameHeight', 'range', 'Flame height', 0.2, 6, 0.05],
      ['jetpack.flameWidth', 'range', 'Flame width', 0.1, 4, 0.05], ['jetpack.flameTurbulence', 'range', 'Turbulence', 0, 2, 0.01], ['jetpack.flameNoiseScale', 'range', 'Noise scale', 0.1, 6, 0.05],
      ['jetpack.flameCoreSize', 'range', 'Core size', 0.05, 2, 0.01], ['jetpack.lightningSpeed', 'range', 'Lightning speed', 0, 30, 0.1], ['jetpack.lightningChaos', 'range', 'Lightning chaos', 0, 2, 0.01],
      ['jetpack.lightningDensity', 'range', 'Lightning branches', 1, 10, 1], ['jetpack.lightningThickness', 'range', 'Lightning thickness', 0.01, 0.4, 0.01], ['jetpack.lightningIntensity', 'range', 'Lightning intensity', 0, 5, 0.05],
      ['jetpack.glowPower', 'range', 'Glow falloff', 0.5, 10, 0.1], ['jetpack.colorBoost', 'range', 'Color boost', 0, 20, 0.1], ['jetpack.baseScale', 'range', 'Flame scale', 0.05, 2, 0.01], ['jetpack.positionOffsetY', 'range', 'Flame Y offset', -3, 1, 0.05],
    ],
    Particles: [
      ['particles.brightness', 'range', 'Particle brightness', 0, 40, 0.1], ['particles.drag', 'range', 'Particle drag', 0, 10, 0.1], ['particles.gravityScale', 'range', 'Particle gravity', 0, 0.08, 0.001],
      ['particles.rapidTrailRate', 'range', 'Rapid trail rate', 0.01, 0.3, 0.001], ['particles.chargedTrailRate', 'range', 'Charged trail rate', 0.005, 0.15, 0.001], ['particles.rapidTrailCount', 'range', 'Rapid trail count', 0, 12, 1],
      ['particles.chargedTrailCountBoost', 'range', 'Charged trail boost', 0, 16, 1],
    ],
    Robot: [
      ['robot.scale', 'range', 'Robot scale', 0.03, 0.5, 0.005], ['robot.turnSmoothMoving', 'range', 'Move turn smooth', 1, 40, 1], ['robot.turnSmoothIdle', 'range', 'Idle turn smooth', 1, 40, 1],
      ['robot.bodyJetpackLean', 'range', 'Jetpack body lean', -1, 1, 0.01], ['robot.bodyAirLean', 'range', 'Air body lean', -0.2, 0.2, 0.005], ['robot.legDangle', 'range', 'Air leg angle', -1.5, 1, 0.01],
      ['robot.legJetpackDangle', 'range', 'Jetpack leg angle', -1.5, 1, 0.01], ['robot.legSwingAmount', 'range', 'Leg swing', 0, 0.6, 0.01], ['robot.legSwayAmount', 'range', 'Leg sway', 0, 0.6, 0.01],
      ['robot.hoverJitterAmount', 'range', 'Hover jitter', 0, 0.3, 0.005], ['robot.crouchBodyDrop', 'range', 'Crouch drop', 0, 1.5, 0.01],
    ],
    Shield: [
      ['shield.color', 'color', 'Shield color'], ['shield.opacity', 'range', 'Opacity', 0, 1, 0.01], ['shield.showHex', 'checkbox', 'Show hex'], ['shield.radius', 'range', 'Radius', 0.2, 2, 0.01],
      ['shield.posY', 'range', 'Y position', -0.5, 2.5, 0.01], ['shield.hexScale', 'range', 'Hex scale', 1, 30, 0.1], ['shield.hexOpacity', 'range', 'Hex opacity', 0, 2, 0.01],
      ['shield.edgeWidth', 'range', 'Hex edge', 0.005, 0.2, 0.005], ['shield.fresnelPower', 'range', 'Fresnel power', 0.2, 8, 0.1], ['shield.fresnelStrength', 'range', 'Fresnel strength', 0, 8, 0.1],
      ['shield.flowSpeed', 'range', 'Flow speed', 0, 8, 0.05], ['shield.flowIntensity', 'range', 'Flow intensity', 0, 12, 0.1], ['shield.noiseEdgeIntensity', 'range', 'Reveal edge glow', 0, 30, 0.1], ['shield.hitIntensity', 'range', 'Hit intensity', 0, 12, 0.1],
    ],
    Audio: [
      ['audio.masterVolume', 'range', 'Master', 0, 1.5, 0.01], ['audio.walking', 'range', 'Walking', 0, 1, 0.01], ['audio.running', 'range', 'Running', 0, 1, 0.01], ['audio.jetpack', 'range', 'Jetpack', 0, 1, 0.01],
      ['audio.charge', 'range', 'Charge', 0, 1, 0.01], ['audio.fire', 'range', 'Fire', 0, 1, 0.01], ['audio.shield', 'range', 'Shield', 0, 1, 0.01], ['audio.servo', 'range', 'Servo', 0, 1, 0.01],
    ],
  };
  const getValue = path => path.split('.').reduce((obj, key) => obj[key], GAME_PARAMS);
  const setValue = (path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    const owner = keys.reduce((obj, key) => obj[key], GAME_PARAMS);
    owner[last] = value;
  };
  Object.entries(groups).forEach(([title, controls]) => {
    const details = document.createElement('details');
    details.open = ['Scene', 'Lighting', 'Camera'].includes(title);
    details.innerHTML = `<summary>${title}</summary>`;
    controls.forEach(([path, type, label, min, max, step]) => {
      const row = document.createElement('label');
      row.className = `control-row control-${type}`;
      const value = getValue(path);
      row.innerHTML = `<span>${label}</span><input type="${type}" ${type === 'range' ? `min="${min}" max="${max}" step="${step}"` : ''}>${type === 'checkbox' ? '' : '<span class="control-value"></span>'}`;
      const input = row.querySelector('input');
      input[type === 'checkbox' ? 'checked' : 'value'] = value;
      const output = row.querySelector('.control-value');
      const updateOutput = next => { if (output) output.textContent = type === 'range' ? Number(next).toFixed(step < 0.01 ? 4 : step < 1 ? 2 : 0) : next; };
      updateOutput(value);
      input.addEventListener('input', () => {
        const next = type === 'checkbox' ? input.checked : (type === 'range' ? Number(input.value) : input.value);
        setValue(path, next);
        updateOutput(next);
        applyGameParams();
      });
      details.appendChild(row);
    });
    body.appendChild(details);
  });
  panel.querySelector('[data-action="toggle"]').addEventListener('click', event => {
    panel.classList.toggle('is-collapsed');
    event.currentTarget.textContent = panel.classList.contains('is-collapsed') ? 'Show' : 'Hide';
  });
  panel.querySelector('[data-action="save"]').addEventListener('click', () => localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(GAME_PARAMS)));
  panel.querySelector('[data-action="reset"]').addEventListener('click', () => {
    localStorage.removeItem(CONTROL_STORAGE_KEY);
    location.reload();
  });
}

createControlPanel();
applyGameParams();

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
      child.layers.set(2);
    }
    if (child.isBone) {
      if (child.name === 'Body_Up') robotBones.body = child;
      if (child.name.match(/^Leg\d+$/)) robotBones.rootLegs.push(child);
    }
  });
  robotModel.scale.setScalar(GAME_PARAMS.robot.scale);
  playerGroup.add(robotModel);

  const muzzlePointInternal = new THREE.Object3D();
  muzzlePointInternal.position.set(0, 4.5, -5.0);
  robotModel.add(muzzlePointInternal);
  muzzlePoint = muzzlePointInternal;
  window.muzzlePoint = muzzlePoint;

  jetpackLight = new THREE.PointLight(0x4488ff, 0, GAME_PARAMS.jetpack.lightDistance);
  scene.add(jetpackLight);

  initShield(scene, GAME_PARAMS.shield);
  playerGroup.add(shieldGroup);
  shieldGroup.position.set(0, GAME_PARAMS.shield.posY, 0);

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN LOOP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, clock.getDelta());

  if (mixer) mixer.update(delta);

  updatePhysics(delta);
  updateProjectiles(delta);
  tickParticles(delta);
  updateJetpackFlame(delta);

  if (mouseMoveTimer > 0) {
    mouseMoveTimer -= delta;
    if (mouseMoveTimer <= 0) isMouseMoving = false;
  }

  if (shieldActive) {
    if (shieldReveal > 0) setShieldReveal(shieldReveal - delta * 2.5);
  } else {
    setShieldReveal(1.0);
  }
  updateShield(delta);

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
    const lerpFactor = isMoving
      ? (1 - Math.exp(-GAME_PARAMS.robot.turnSmoothMoving * delta))
      : (1 - Math.exp(-GAME_PARAMS.robot.turnSmoothIdle * delta));
    robotModel.rotation.y += diff * lerpFactor;

    if (runAction) {
      const isTurning = Math.abs(diff) > GAME_PARAMS.robot.turnAnimationThreshold;
      if (playerOnFloor && (isMoving || isTurning)) {
        runAction.paused = false;
        const targetScale = isMoving ? (keys.shift ? 2.0 : 1.0) : 0.6;
        runAction.setEffectiveTimeScale(targetScale);
        runAction.setEffectiveWeight(isMoving ? 1.0 : 0.5);
      } else {
        runAction.paused = true;
      }
    }

    if (!isMoving && playerOnFloor && Math.abs(diff) > 0.01 && isMouseMoving) {
      if (!sfx.servo.isPlaying) sfx.servo.play();
    } else {
      if (sfx.servo.isPlaying) sfx.servo.stop();
    }
  }

  if (robotModel && robotBones.body) {
    robotBones.body.position.set(0, 0, 0);
    robotBones.body.rotation.set(0, 0, 0);
    robotBones.rootLegs.forEach(l => { l.position.set(0, 0, 0); l.rotation.set(0, 0, 0); });

    if (isJetpacking || !playerOnFloor) {
      const horizontalVel = new THREE.Vector2(playerVelocity.x, playerVelocity.z);
      const speed = horizontalVel.length();

      if (runAction) runAction.setEffectiveWeight(0.0);

      robotBones.body.rotation.x = isJetpacking ? GAME_PARAMS.robot.bodyJetpackLean : (speed * GAME_PARAMS.robot.bodyAirLean);

      const swing = Math.sin(clock.elapsedTime * GAME_PARAMS.robot.legSwingSpeed) * GAME_PARAMS.robot.legSwingAmount;
      const verticalDrag = Math.max(-0.7, Math.min(0.7, -playerVelocity.y * GAME_PARAMS.robot.verticalDragAmount));

      robotBones.rootLegs.forEach((l, i) => {
        l.rotation.set(0, 0, 0);
        l.rotation.x = isJetpacking ? GAME_PARAMS.robot.legJetpackDangle : GAME_PARAMS.robot.legDangle;
        l.rotation.x += verticalDrag + swing;
        l.rotation.z = (Math.cos(clock.elapsedTime * GAME_PARAMS.robot.legSwaySpeed + i) * GAME_PARAMS.robot.legSwayAmount);
      });

      if (isJetpacking) {
        robotBones.body.position.y += Math.sin(clock.elapsedTime * GAME_PARAMS.robot.hoverJitterSpeed) * GAME_PARAMS.robot.hoverJitterAmount;
      }
    } else {
      if (runAction) runAction.setEffectiveWeight(1.0);
      if (keys.ctrl) {
        robotBones.body.position.y -= GAME_PARAMS.robot.crouchBodyDrop;
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
JSEOF
