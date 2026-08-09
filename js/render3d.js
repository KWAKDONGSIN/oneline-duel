import * as THREE from "three";

let scene;
let camera;
let renderer;
let container;
let actors;
let phase = "idle";
let clock;
let running = false;
let orbitAngle = 0;
let shakePower = 0;
let resizeObserver;
let floorMesh;
let hemiLight;
let dirLight;
let motes;          // 필드 분위기를 만드는 떠다니는 입자
let moteFall = 0;   // 0이면 부유, 1이면 비처럼 떨어짐
let moteCount = 0;
let onMotion = null;   // 모션 시작 알림 (효과음 연결용)

// 모션이 재생될 때마다 호출될 함수를 등록한다. 렌더러가 소리를 직접 다루지 않게 분리했다.
export function setMotionListener(fn) { onMotion = fn; }

// 현재 무대 상태. 필드 배경이 제대로 적용됐는지 확인할 때 쓴다.
export function stageState() {
  return scene ? {
    background: "#" + scene.background.getHexString(),
    floor: "#" + floorMesh.material.color.getHexString(),
    motes: motes ? moteCount : 0,
    rain: Boolean(moteFall),
  } : null;
}

const COLORS = { p1: 0x3ca8ff, p2: 0xff5a3c };
const EFFECT_COLORS = {
  fire: 0xff5522, water: 0x35a7ff, lightning: 0xf4e84a, wind: 0xb9f3df,
  earth: 0xaa7744, shield: 0x72d7ff, heal: 0x5cff8d, dark: 0x7b4dff, light: 0xfff3b0,
};

// 필드 12종의 분위기. sky=배경/안개색, floor=바닥색, hemi/dir=조명색, mote=떠다니는 입자색(없으면 생략).
const FIELD_MOODS = {
  1:  { sky: 0x2a0d08, floor: 0x4a1c10, hemi: 0xff7a3c, dir: 0xffb066, mote: 0xff6a2a, fogNear: 5.0 },  // 화산지대
  2:  { sky: 0x0b1520, floor: 0x1b2b38, hemi: 0x6fb8ff, dir: 0xbfe0ff, mote: 0x9fd8ff, rain: true },    // 폭우
  3:  { sky: 0x14121f, floor: 0x24222f, hemi: 0x8f7dff, dir: 0xfff2a8, mote: 0xffe45c },                // 뇌운
  4:  { sky: 0x2b2213, floor: 0x51422a, hemi: 0xd9b478, dir: 0xffe0a0, mote: 0xd9b478, fogNear: 4.2 },  // 모래폭풍
  5:  { sky: 0x0e1a22, floor: 0xbfe6f2, hemi: 0x9fe4ff, dir: 0xffffff, mote: 0xd8f4ff },                // 얼어붙은 호수
  6:  { sky: 0x1a1510, floor: 0x3a2c1e, hemi: 0xffd9a0, dir: 0xffeccc },                                // 고요한 도서관
  7:  { sky: 0x101828, floor: 0x8fa8c8, hemi: 0xcfe4ff, dir: 0xffffff, mote: 0xffffff },                // 거울의 방
  8:  { sky: 0x05060b, floor: 0x12121c, hemi: 0x3a3a66, dir: 0x8888cc, mote: 0x6f6fbf },                // 그믐밤
  9:  { sky: 0x1b1608, floor: 0x3d3418, hemi: 0xffe9a8, dir: 0xfff6d6, mote: 0xffe9a8 },                // 성역
  10: { sky: 0x05030f, floor: 0x140f26, hemi: 0x7a5cff, dir: 0xd0c0ff, mote: 0xffffff, fogNear: 6.5 },  // 무중력
  11: { sky: 0x1c150e, floor: 0x5a4426, hemi: 0xffc978, dir: 0xfff0d0, mote: 0xffd08a },                // 콜로세움
  12: { sky: 0x171b1c, floor: 0x2b3234, hemi: 0xaebfc2, dir: 0xd6e2e4, mote: 0xc8d6d8, fogNear: 3.6 },  // 안개 골짜기
};
const DEFAULT_MOOD = { sky: 0x11111a, floor: 0x242432, hemi: 0x99bbff, dir: 0xffffff, fogNear: 5.5 };

function limb(length, radius, material) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 10), material);
  mesh.position.y = -length / 2;
  return mesh;
}

function makeActor(side) {
  const material = new THREE.MeshStandardMaterial({ color: COLORS[side], roughness: 0.55, metalness: 0.12 });
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 0.72, 6, 12), material);
  body.position.y = 1.55;
  torso.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), material);
  head.position.y = 2.35;
  torso.add(head);

  const joints = { root, torso, head };
  for (const [name, x] of [["armL", -0.43], ["armR", 0.43]]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 1.95, 0);
    shoulder.add(limb(0.66, 0.1, material));
    torso.add(shoulder);
    joints[name] = shoulder;
  }
  for (const [name, x] of [["legL", -0.2], ["legR", 0.2]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 1.1, 0);
    hip.add(limb(0.9, 0.12, material));
    torso.add(hip);
    joints[name] = hip;
  }
  root.position.set(side === "p1" ? -1.65 : 1.65, 0, 0);
  root.rotation.y = side === "p1" ? Math.PI / 2 : -Math.PI / 2;
  root.userData.homeX = root.position.x;
  root.userData.side = side;
  root.userData.wounds = 0;
  scene.add(root);
  return joints;
}

function resetPose(actor) {
  const lean = Math.max(0, actor.root.userData.wounds - 1) * 0.16;
  actor.torso.rotation.set(0, 0, actor.root.userData.side === "p1" ? lean : -lean);
  actor.armL.rotation.set(0, 0, -0.18);
  actor.armR.rotation.set(0, 0, 0.18);
  actor.legL.rotation.set(0, 0, -0.08);
  actor.legR.rotation.set(0, 0, 0.08);
  actor.root.position.x = actor.root.userData.homeX;
  actor.root.position.y = 0;
  actor.root.scale.setScalar(1);
}

function makeBeam(from, to, color) {
  const length = from.distanceTo(to);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.13, length, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
  );
  beam.position.copy(from).add(to).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  scene.add(beam);
  return tween(420, (eased) => {
    beam.scale.x = 1 + Math.sin(eased * Math.PI) * 1.8;
    beam.scale.z = beam.scale.x;
    beam.material.opacity = 1 - eased * 0.85;
  }).then(() => scene.remove(beam));
}

function summonDragon(from, to, direction) {
  const dragon = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xff5b24, emissive: 0x661500, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 5, 10), material);
  body.rotation.z = Math.PI / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), material);
  head.position.x = direction * 0.5;
  const wingGeometry = new THREE.ConeGeometry(0.42, 0.78, 3);
  const wingL = new THREE.Mesh(wingGeometry, material);
  const wingR = wingL.clone();
  wingL.position.set(0, 0.28, -0.25);
  wingR.position.set(0, 0.28, 0.25);
  wingL.rotation.x = 1.15;
  wingR.rotation.x = -1.15;
  dragon.add(body, head, wingL, wingR);
  dragon.position.copy(from).add(new THREE.Vector3(0, 0.6, 0));
  dragon.scale.setScalar(0.15);
  scene.add(dragon);
  return tween(900, (eased, linear) => {
    dragon.position.lerpVectors(from.clone().add(new THREE.Vector3(0, 0.6, 0)), to.clone().add(new THREE.Vector3(0, 0.8, 0)), eased);
    dragon.position.y += Math.sin(linear * Math.PI * 3) * 0.28;
    dragon.scale.setScalar(0.15 + Math.sin(Math.min(1, linear * 1.8) * Math.PI / 2) * 0.85);
    wingL.rotation.z = Math.sin(linear * Math.PI * 8) * 0.45;
    wingR.rotation.z = -wingL.rotation.z;
  }).then(() => {
    burst(to.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff5522, 48);
    scene.remove(dragon);
  });
}

// 애니메이션 한 구간. requestAnimationFrame은 탭이 백그라운드로 가면 멈추므로,
// 타이머로 안전장치를 걸어 두지 않으면 그 사이에 시작한 턴이 영영 끝나지 않는다.
function tween(duration, update) {
  return new Promise((resolve) => {
    const started = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      update(1, 1);   // 중간에 멈췄더라도 최종 상태로 맞춰 놓는다
      resolve();
    };
    const guard = setTimeout(finish, duration + 1_000);
    function frame(now) {
      if (done) return;
      const t = Math.min(1, (now - started) / duration);
      update(1 - (1 - t) ** 3, t);
      if (t < 1) requestAnimationFrame(frame); else finish();
    }
    requestAnimationFrame(frame);
  });
}

function projectile(from, to, color, size = 0.11) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color }));
  mesh.position.copy(from);
  scene.add(mesh);
  return tween(360, (eased) => mesh.position.lerpVectors(from, to, eased)).then(() => scene.remove(mesh));
}

function burst(position, color, count = 22) {
  const group = new THREE.Group();
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color }));
    const direction = new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize();
    particle.userData.direction = direction;
    group.add(particle);
    items.push(particle);
  }
  group.position.copy(position);
  scene.add(group);
  tween(480, (eased) => {
    for (const item of items) item.position.copy(item.userData.direction).multiplyScalar(eased * 1.2);
    group.scale.setScalar(1 - eased * 0.35);
  }).then(() => scene.remove(group));
}

async function animateMotion({ actor: side, motion }) {
  onMotion?.(motion);   // 동작이 시작되는 순간에 그 동작의 효과음을 낸다
  const actor = actors[side];
  const target = actors[side === "p1" ? "p2" : "p1"];
  resetPose(actor);
  const direction = side === "p1" ? 1 : -1;
  const origin = actor.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const destination = target.root.position.clone().add(new THREE.Vector3(0, 1.45, 0));

  if (motion === "summon") {
    actor.armL.rotation.z = direction * 1.5;
    actor.armR.rotation.z = -direction * 1.5;
    burst(origin, 0x9a56ff, 32);
    await summonDragon(origin, destination, direction);
  } else if (motion === "cast") {
    actor.armR.rotation.z = -direction * 1.7;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: 0xb783ff }));
    ring.position.copy(origin).add(new THREE.Vector3(direction * 0.35, 0.35, 0));
    ring.rotation.y = Math.PI / 2;
    scene.add(ring);
    await tween(580, (eased) => { ring.rotation.z = eased * Math.PI * 3; ring.scale.setScalar(0.4 + eased); });
    scene.remove(ring);
    await projectile(origin, destination, 0xb783ff, 0.15);
  } else if (["shoot", "laser", "flame", "water_burst", "bolt", "gust", "throw"].includes(motion)) {
    actor.armR.rotation.z = -direction * 1.35;
    actor.torso.rotation.z = -direction * 0.12;
    const color = motion === "flame" ? 0xff5522 : motion === "water_burst" ? 0x35a7ff
      : motion === "bolt" ? 0xffff66 : motion === "gust" ? 0xb9f3df : 0xffffff;
    if (motion === "laser") await makeBeam(origin, destination, color);
    else await projectile(origin, destination, color, 0.11);
    burst(destination, color, motion === "flame" ? 34 : 20);
  } else if (motion === "teleport") {
    await tween(180, (eased) => actor.root.scale.setScalar(1 - eased));
    actor.root.position.x = target.root.position.x - direction * 0.8;
    await tween(180, (eased) => actor.root.scale.setScalar(eased));
  } else if (["slash", "stab", "counter", "punch_rush", "kick", "grab_throw"].includes(motion)) {
    const startX = actor.root.position.x;
    await tween(230, (eased) => {
      actor.root.position.x = startX + direction * eased * 1.35;
      actor.armR.rotation.z = -direction * eased * (motion === "stab" ? 1.55 : 2.45);
      if (motion === "kick") actor.legR.rotation.z = -direction * eased * 1.6;
    });
    burst(destination, 0xffffff, motion === "punch_rush" ? 30 : 16);
    camera.position.x += direction * 0.12;
    await tween(260, (eased) => { actor.root.position.x = startX + direction * (1 - eased) * 1.35; });
  } else if (motion === "dodge") {
    const startX = actor.root.position.x;
    await tween(220, (eased) => {
      actor.root.position.x = startX - direction * eased * 0.8;
      actor.torso.rotation.z = direction * eased * 0.55;
    });
  } else if (motion === "block") {
    actor.armL.rotation.z = direction * 1.2;
    actor.armR.rotation.z = -direction * 1.2;
    burst(origin, 0x72d7ff, 28);
    await tween(520, () => {});
  } else if (["charge_up", "heal_aura", "stealth", "taunt", "bind", "explosion", "quake"].includes(motion)) {
    actor.torso.rotation.x = -0.22;
    burst(motion === "explosion" ? destination : origin,
      motion === "heal_aura" ? 0x5cff8d : motion === "stealth" ? 0x7b4dff : 0xffbb55, 36);
    await tween(650, (eased) => { actor.root.position.y = Math.sin(eased * Math.PI) * 0.18; });
  } else {
    await tween(520, (eased) => {
      actor.armL.rotation.z = Math.sin(eased * Math.PI * 4) * 0.9;
      actor.armR.rotation.z = -Math.sin(eased * Math.PI * 4) * 0.9;
    });
  }
  resetPose(actor);
}

function renderLoop() {
  if (!running) return;
  requestAnimationFrame(renderLoop);
  const elapsed = clock.getElapsedTime();
  if (phase === "typing" && actors) {
    orbitAngle = elapsed * 0.105;
    camera.position.x = Math.sin(orbitAngle) * 0.65;
    camera.position.z = 6.7 + Math.cos(orbitAngle) * 0.25;
    actors.p1.root.position.x = actors.p1.root.userData.homeX + Math.sin(elapsed * 0.45) * 0.11;
    actors.p2.root.position.x = actors.p2.root.userData.homeX - Math.sin(elapsed * 0.45) * 0.11;
    actors.p1.root.position.z = Math.cos(elapsed * 0.45) * 0.16;
    actors.p2.root.position.z = -Math.cos(elapsed * 0.45) * 0.16;
    actors.p1.root.position.y = Math.sin(elapsed * 1.4) * 0.025;
    actors.p2.root.position.y = Math.sin(elapsed * 1.4 + Math.PI) * 0.025;
    const feint1 = Math.max(0, Math.sin(elapsed * 1.7) - 0.92) * 8;
    const feint2 = Math.max(0, Math.sin(elapsed * 1.7 + 2.4) - 0.92) * 8;
    actors.p1.armR.rotation.z = 0.18 - feint1;
    actors.p2.armR.rotation.z = 0.18 + feint2;
  }
  // 필드 입자 움직임. 비는 떨어지고, 나머지는 천천히 위로 떠오른다. 바닥에 닿으면 위로 되돌린다.
  if (motes) {
    const p = motes.geometry.attributes.position;
    const speed = moteFall ? 0.09 : 0.006;
    for (let i = 1; i < p.array.length; i += 3) {
      p.array[i] += moteFall ? -speed : speed;
      if (moteFall ? p.array[i] < 0 : p.array[i] > 5) p.array[i] = moteFall ? 5 : 0;
    }
    p.needsUpdate = true;
    if (!moteFall) motes.rotation.y = elapsed * 0.02;
  }

  camera.position.y = 2.8;
  camera.lookAt(0, 1.25, 0);
  if (shakePower > 0.002) {
    camera.rotation.z += (Math.random() - 0.5) * shakePower;
    camera.position.y += (Math.random() - 0.5) * shakePower * 0.12;
    shakePower *= 0.88;
  }
  renderer.render(scene, camera);
}

// 컨테이너 크기에 맞춰 캔버스를 다시 맞춘다. container 전역을 보므로 무대를 옮겨도 안전하다.
function resizeToContainer() {
  if (!renderer || !container) return;
  const width = container.clientWidth || 400;
  const height = container.clientHeight || 220;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

// 무대 div가 새로 그려져도 캔버스만 옮겨 붙인다. 씬을 다시 만들면 WebGL 컨텍스트가 누수된다.
function attachTo(target) {
  container = target;
  target.innerHTML = "";
  target.append(renderer.domElement);
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(resizeToContainer);
  resizeObserver.observe(target);
  resizeToContainer();
}

export function init(target) {
  if (!target) return;
  if (renderer) {
    if (container !== target) attachTo(target);
    else resizeToContainer();
    return;
  }
  container = target;
  target.innerHTML = "";
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11111a);
  scene.fog = new THREE.Fog(0x11111a, 5.5, 10);
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  camera.position.set(0, 2.8, 6.8);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  target.append(renderer.domElement);
  floorMesh = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48), new THREE.MeshStandardMaterial({ color: 0x242432, roughness: 0.88 }));
  floorMesh.rotation.x = -Math.PI / 2;
  hemiLight = new THREE.HemisphereLight(0x99bbff, 0x332222, 1.6);
  scene.add(floorMesh, hemiLight);
  dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
  dirLight.position.set(3, 6, 4);
  scene.add(dirLight);
  actors = { p1: makeActor("p1"), p2: makeActor("p2") };
  resizeObserver = new ResizeObserver(resizeToContainer);
  resizeObserver.observe(target);
  resizeToContainer();
  clock = new THREE.Clock();
  if (!running) { running = true; renderLoop(); }
}

export function setActors() {}
export function setPhase(nextPhase) { phase = nextPhase; }

// 필드가 바뀌면 배경·안개·바닥·조명 색과 떠다니는 입자를 그 필드 분위기로 갈아끼운다.
export function setField(field) {
  if (!scene) return;
  const mood = FIELD_MOODS[field?.id] || DEFAULT_MOOD;

  scene.background = new THREE.Color(mood.sky);
  scene.fog = new THREE.Fog(mood.sky, mood.fogNear ?? 5.5, (mood.fogNear ?? 5.5) + 4.5);
  floorMesh.material.color.setHex(mood.floor);
  hemiLight.color.setHex(mood.hemi);
  dirLight.color.setHex(mood.dir);

  if (motes) { scene.remove(motes); motes.geometry.dispose(); motes.material.dispose(); motes = null; }
  moteFall = mood.rain ? 1 : 0;
  if (!mood.mote) return;

  // 입자 120개를 무대 위에 흩뿌린다. 비 필드는 아래로 떨어지고, 나머지는 천천히 부유한다.
  const count = 120;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 8;
    positions[i * 3 + 1] = Math.random() * 5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  moteCount = count;
  motes = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: mood.mote,
    size: mood.rain ? 0.05 : 0.07,
    transparent: true,
    opacity: mood.rain ? 0.75 : 0.6,
    depthWrite: false,
  }));
  scene.add(motes);
}

export async function playTurn(motions = [], effects = [], onDone = () => {}) {
  phase = "resolving";
  const strongest = [...effects].sort((a, b) => b.intensity - a.intensity)[0];
  const cameraStart = camera.position.clone();
  if (strongest && actors[strongest.target]) {
    const targetX = actors[strongest.target].root.position.x * 0.34;
    if (strongest.intensity === 3) {
      await tween(280, (eased) => {
        camera.position.x = THREE.MathUtils.lerp(cameraStart.x, targetX, eased);
        camera.position.z = THREE.MathUtils.lerp(cameraStart.z, 5.55, eased);
      });
    }
    shakePower = strongest.intensity * 0.035;
  }
  for (const effect of effects) {
    const target = actors[effect.target]?.root.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    if (target) burst(target, EFFECT_COLORS[effect.type] || 0xffffff, 12 + effect.intensity * 8);
  }
  for (const motion of motions) await animateMotion(motion);
  const cameraReturnStart = camera.position.clone();
  await tween(320, (eased) => camera.position.lerpVectors(cameraReturnStart, cameraStart, eased));
  phase = "typing";
  onDone();
}

export function setWounds(side, wounds) {
  if (actors?.[side]) {
    actors[side].root.userData.wounds = wounds;
    resetPose(actors[side]);
  }
}

export function lastStand(side) {
  if (!actors?.[side]) return;
  burst(actors[side].root.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff234f, 50);
}

export function finish(winner) {
  phase = "idle";
  if (winner === "p1" || winner === "p2") actors[winner].armR.rotation.z = winner === "p1" ? -2.7 : 2.7;
}
