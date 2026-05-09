// ═══════════════════════════════════════════════════════════════════════════════
// FORCE SHIELD — extracted from Shield Siege
// Depends on: THREE (r128+)
// ═══════════════════════════════════════════════════════════════════════════════
//
// INTEGRATION:
//   1. initShield(scene)              — call once after scene init
//   2. updateShield(delta)            — call every frame
//   3. registerShieldHit(worldPoint)  — call on projectile collision
//   4. setShieldLife(0–1)             — drives color shift + HUD
//   5. shieldGroup / shieldMesh       — transform/parent as needed
//

import * as THREE from 'three';

export const SHIELD_CONFIG = {
  radius: 1.8, maxHits: 6, posY: 2.0,
  hexScale: 3.0, hexOpacity: 0.13, showHex: true, edgeWidth: 0.06,
  fresnelPower: 1.8, fresnelStrength: 1.75,
  color: '#26aeff', opacity: 0.76, fadeStart: -1.0,
  flashSpeed: 0.6, flashIntensity: 0.11,
  noiseScale: 1.3, noiseEdgeColor: '#26aeff',
  noiseEdgeWidth: 0.02, noiseEdgeIntensity: 10.0, noiseEdgeSmoothness: 0.5,
  flowScale: 2.4, flowSpeed: 1.13, flowIntensity: 4.0,
  hitRingSpeed: 1.75, hitRingWidth: 0.12, hitMaxRadius: 0.85,
  hitDuration: 1.8, hitIntensity: 4.1, hitImpactRadius: 0.3,
};

export let shieldLife = 1.0;
export let shieldReveal = 1.0;
export let shieldRevealSpeed = 3.5;
export function setShieldLife(v)   { shieldLife   = Math.max(0, Math.min(1, v)); }
export function setShieldReveal(v) { shieldReveal = Math.max(0, Math.min(1, v)); }

let _clock = 0, _hitIdx = 0;
let _hitPositions, _hitTimes, _mat;
export let shieldMesh = null, shieldGroup = null;

const _vert = `
  varying vec3 vNormal, vViewDir, vObjPos;
  void main() {
    vObjPos = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 vp = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-vp.xyz);
    gl_Position = projectionMatrix * vp;
  }
`;

const _frag = `
  #define MAX_HITS 6
  uniform float uTime; uniform vec3 uColor; uniform float uLife;
  uniform float uHexScale, uEdgeWidth, uFresnelPower, uFresnelStrength;
  uniform float uOpacity, uReveal, uFlashSpeed, uFlashIntensity;
  uniform float uNoiseScale; uniform vec3 uNoiseEdgeColor;
  uniform float uNoiseEdgeWidth, uNoiseEdgeIntensity, uNoiseEdgeSmoothness;
  uniform float uHexOpacity, uShowHex, uFlowScale, uFlowSpeed, uFlowIntensity;
  uniform vec3 uHitPos[MAX_HITS]; uniform float uHitTime[MAX_HITS];
  uniform float uHitRingSpeed, uHitRingWidth, uHitMaxRadius;
  uniform float uHitDuration, uHitIntensity, uHitImpactRadius, uFadeStart;
  varying vec3 vNormal, vViewDir, vObjPos;

  vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
  vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
  vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
    vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
    vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
    i=mod289v3(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
    float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
    vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
    return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  vec3 lifeColor(float l){return mix(vec3(1.0,0.08,0.04),uColor,l);}
  float hexPattern(vec2 p){
    p*=uHexScale;const vec2 s=vec2(1.,1.7320508);
    vec4 hC=floor(vec4(p,p-vec2(.5,1.))/s.xyxy)+.5;
    vec4 h=vec4(p-hC.xy*s,p-(hC.zw+.5)*s);
    vec2 cell=(dot(h.xy,h.xy)<dot(h.zw,h.zw))?h.xy:h.zw;cell=abs(cell);
    return smoothstep(.5-uEdgeWidth,.5,max(dot(cell,s*.5),cell.x));
  }
  vec2 hexCellId(vec2 p){
    p*=uHexScale;const vec2 s=vec2(1.,1.7320508);
    vec4 hC=floor(vec4(p,p-vec2(.5,1.))/s.xyxy)+.5;
    vec4 h=vec4(p-hC.xy*s,p-(hC.zw+.5)*s);
    return (dot(h.xy,h.xy)<dot(h.zw,h.zw))?hC.xy:hC.zw+.5;
  }
  float cellFlash(vec2 cId){
    float r=fract(sin(dot(cId,vec2(127.1,311.7)))*43758.5453);
    return smoothstep(.6,1.,sin(uTime*uFlashSpeed*(.5+r*1.5)+r*6.2831))*uFlashIntensity;
  }
  vec3 faceNormal(){return gl_FrontFacing?vNormal:-vNormal;}

  void main(){
    float noise=snoise(vObjPos*uNoiseScale)*.5+.5;
    float revealMask=smoothstep(uReveal-uNoiseEdgeWidth,uReveal,noise);
    if(revealMask<0.001) discard;
    float innerFade=mix(0.98,0.15,uNoiseEdgeSmoothness);
    float edgeLow=smoothstep(uReveal-uNoiseEdgeWidth,uReveal-uNoiseEdgeWidth*innerFade,noise);
    float edgeHigh=smoothstep(uReveal-uNoiseEdgeWidth*0.15,uReveal,noise);
    float revealEdge=edgeLow*(1.-edgeHigh);
    float fresnel=pow(1.-abs(dot(faceNormal(),vViewDir)),uFresnelPower)*uFresnelStrength;
    float t=uTime*uFlowSpeed;
    float fn1=snoise(vObjPos*uFlowScale+vec3(t,t*.6,t*.4));
    float fn2=snoise(vObjPos*uFlowScale*2.1+vec3(-t*.5,t*.9,t*.3));
    float flowNoise=(fn1*.6+fn2*.4)*.5+.5;
    vec3 absN=abs(normalize(vObjPos));float dom=max(absN.x,max(absN.y,absN.z));
    float hexFade=smoothstep(.65,.85,dom);
    vec2 faceUV;
    if(absN.x>=absN.y&&absN.x>=absN.z) faceUV=vObjPos.yz;
    else if(absN.y>=absN.z) faceUV=vObjPos.xz;
    else faceUV=vObjPos.xy;
    float hex=hexPattern(faceUV)*hexFade;
    float flash=cellFlash(hexCellId(faceUV))*hexFade;
    vec3 normPos=normalize(vObjPos);
    float ringContrib=0.,hexHitBoost=0.;
    for(int i=0;i<MAX_HITS;i++){
      float ht=uHitTime[i];float elapsed=uTime-ht;
      float isActive=step(0.,ht)*step(0.,elapsed)*step(elapsed,uHitDuration);
      float dist=acos(clamp(dot(normPos,normalize(uHitPos[i])),-1.,1.));
      float ringR=min(elapsed*uHitRingSpeed,uHitMaxRadius);
      float noiseD=snoise(normPos*5.+vec3(elapsed*2.))*.05;
      float ring=smoothstep(uHitRingWidth,0.,abs(dist+noiseD-ringR));
      float fade=1.-smoothstep(uHitDuration*.5,uHitDuration,elapsed);
      float radialFade=1.-smoothstep(uHitMaxRadius*.75,uHitMaxRadius,ringR);
      ringContrib+=ring*fade*radialFade*isActive;
      hexHitBoost+=smoothstep(uHitImpactRadius,0.,dist)*(1.-smoothstep(0.,uHitDuration*.35,elapsed))*isActive;
    }
    ringContrib=min(ringContrib,2.);hexHitBoost=min(hexHitBoost,1.);
    vec3 lColor=lifeColor(uLife);
    float effHex=(uHexOpacity+hexHitBoost*uHitIntensity)*uShowHex;
    float intensity=hex*effHex*(.3+fresnel*.7)+fresnel*.4+flash*uShowHex;
    vec3 shieldColor=lColor*intensity*2.+lColor*(flowNoise*fresnel*uFlowIntensity)+lColor*ringContrib*uHitIntensity;
    vec3 edgeGlow=mix(uNoiseEdgeColor,lColor,1.-uLife)*revealEdge*uNoiseEdgeIntensity;
    float alpha=clamp(intensity*uOpacity*revealMask+revealEdge*uNoiseEdgeIntensity,0.,1.);
    alpha*=smoothstep(-1.,uFadeStart,vObjPos.y/1.8);
    gl_FragColor=vec4(shieldColor+edgeGlow,alpha);
  }
`;

export function initShield(scene, overrides = {}) {
  const cfg = { ...SHIELD_CONFIG, ...overrides };
  _hitPositions = Array.from({ length: cfg.maxHits }, () => new THREE.Vector3(0, cfg.posY, 0));
  _hitTimes = new Array(cfg.maxHits).fill(-999);

  _mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:                { value: 0 },
      uColor:               { value: new THREE.Color(cfg.color) },
      uLife:                { value: shieldLife },
      uHexScale:            { value: cfg.hexScale },
      uEdgeWidth:           { value: cfg.edgeWidth },
      uFresnelPower:        { value: cfg.fresnelPower },
      uFresnelStrength:     { value: cfg.fresnelStrength },
      uOpacity:             { value: cfg.opacity },
      uReveal:              { value: shieldReveal },
      uFlashSpeed:          { value: cfg.flashSpeed },
      uFlashIntensity:      { value: cfg.flashIntensity },
      uNoiseScale:          { value: cfg.noiseScale },
      uNoiseEdgeColor:      { value: new THREE.Color(cfg.noiseEdgeColor) },
      uNoiseEdgeWidth:      { value: cfg.noiseEdgeWidth },
      uNoiseEdgeIntensity:  { value: cfg.noiseEdgeIntensity },
      uNoiseEdgeSmoothness: { value: cfg.noiseEdgeSmoothness },
      uHexOpacity:          { value: cfg.hexOpacity },
      uShowHex:             { value: cfg.showHex ? 1.0 : 0.0 },
      uFlowScale:           { value: cfg.flowScale },
      uFlowSpeed:           { value: cfg.flowSpeed },
      uFlowIntensity:       { value: cfg.flowIntensity },
      uHitPos:              { value: _hitPositions },
      uHitTime:             { value: _hitTimes },
      uHitRingSpeed:        { value: cfg.hitRingSpeed },
      uHitRingWidth:        { value: cfg.hitRingWidth },
      uHitMaxRadius:        { value: cfg.hitMaxRadius },
      uHitDuration:         { value: cfg.hitDuration },
      uHitIntensity:        { value: cfg.hitIntensity },
      uHitImpactRadius:     { value: cfg.hitImpactRadius },
      uFadeStart:           { value: cfg.fadeStart },
    },
    vertexShader: _vert, fragmentShader: _frag,
    transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });

  shieldGroup = new THREE.Group();
  shieldGroup.position.set(0, cfg.posY, 0);
  scene.add(shieldGroup);

  shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(cfg.radius, 64, 64), _mat);
  shieldMesh.renderOrder = 2;
  shieldGroup.add(shieldMesh);
}

export function updateShield(delta) {
  if (!_mat) return;
  _clock += delta;
  _mat.uniforms.uTime.value   = _clock;
  _mat.uniforms.uLife.value   = shieldLife;
  _mat.uniforms.uReveal.value = shieldReveal;
}

export function registerShieldHit(worldPoint) {
  if (!_mat || !shieldGroup) return;
  const local = worldPoint.clone()
    .sub(shieldGroup.position)
    .normalize()
    .multiplyScalar(SHIELD_CONFIG.radius);
  const idx = _hitIdx % SHIELD_CONFIG.maxHits;
  _hitIdx++;
  _mat.uniforms.uHitPos.value[idx].copy(local);
  _mat.uniforms.uHitTime.value[idx] = _clock;
}

export function playShieldReveal() { shieldReveal = 1.0; }
export function resetShieldHits()  { _hitIdx = 0; if (_mat) _mat.uniforms.uHitTime.value.fill(-999); }
