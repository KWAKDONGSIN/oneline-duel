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

const COLORS = { p1: 0x3ca8ff, p2: 0xff5a3c };
const EFFECT_COLORS = {
  fire: 0xff5522, water: 0x35a7ff, lightning: 0xf4e84a, wind: 0xb9f3df,
  earth: 0xaa7744, shield: 0x72d7ff, heal: 0x5cff8d, dark: 0x7b4dff, light: 0xfff3b0,
};

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
  scene.add(root);
  return joints;
}

function resetPose(actor) {
  actor.torso.rotation.set(0, 0, 0);
  actor.armL.rotation.set(0, 0, -0.18);
  actor.armR.rotation.set(0, 0, 0.18);
  actor.legL.rotation.set(0, 0, -0.08);
  actor.legR.rotation.set(0, 0, 0.08);
  actor.root.position.x = actor.root.userData.homeX;
  actor.root.position.y = 0;
  actor.root.scale.setScalar(1);
}

function tween(duration, update) {
  return new Promise((resolve) => {
    const started = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - started) / duration);
      update(1 - (1 - t) ** 3, t);
      if (t < 1) requestAnimationFrame(frame); else resolve();
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
  const actor = actors[side];
  const target = actors[side === "p1" ? "p2" : "p1"];
  resetPose(actor);
  const direction = side === "p1" ? 1 : -1;
  const origin = actor.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const destination = target.root.position.clone().add(new THREE.Vector3(0, 1.45, 0));

  if (["shoot", "laser", "flame", "water_burst", "bolt", "gust", "throw", "cast", "summon"].includes(motion)) {
    actor.armR.rotation.z = -direction * 1.35;
    actor.torso.rotation.z = -direction * 0.12;
    const color = motion === "flame" ? 0xff5522 : motion === "water_burst" ? 0x35a7ff
      : motion === "bolt" ? 0xffff66 : motion === "gust" ? 0xb9f3df : 0xffffff;
    await projectile(origin, destination, color, motion === "laser" ? 0.18 : 0.11);
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
    orbitAngle += 0.0014;
    camera.position.x = Math.sin(orbitAngle) * 0.65;
    camera.position.z = 6.7 + Math.cos(orbitAngle) * 0.25;
    actors.p1.root.position.y = Math.sin(elapsed * 1.4) * 0.025;
    actors.p2.root.position.y = Math.sin(elapsed * 1.4 + Math.PI) * 0.025;
    actors.p1.armR.rotation.z = 0.18 + Math.sin(elapsed * 0.8) * 0.08;
    actors.p2.armR.rotation.z = 0.18 + Math.sin(elapsed * 0.8 + 1) * 0.08;
  }
  camera.lookAt(0, 1.25, 0);
  renderer.render(scene, camera);
}

export function init(target) {
  if (container === target && renderer) return;
  if (renderer) renderer.dispose();
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
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48), new THREE.MeshStandardMaterial({ color: 0x242432, roughness: 0.88 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor, new THREE.HemisphereLight(0x99bbff, 0x332222, 1.6));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(3, 6, 4);
  scene.add(light);
  actors = { p1: makeActor("p1"), p2: makeActor("p2") };
  const resize = () => {
    const width = target.clientWidth || 400;
    const height = target.clientHeight || 220;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(target);
  resize();
  clock = new THREE.Clock();
  if (!running) { running = true; renderLoop(); }
}

export function setActors() {}
export function setPhase(nextPhase) { phase = nextPhase; }

export async function playTurn(motions = [], effects = [], onDone = () => {}) {
  phase = "resolving";
  for (const effect of effects) {
    const target = actors[effect.target]?.root.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    if (target) burst(target, EFFECT_COLORS[effect.type] || 0xffffff, 12 + effect.intensity * 8);
  }
  for (const motion of motions) await animateMotion(motion);
  phase = "typing";
  onDone();
}

export function setWounds(side, wounds) {
  if (actors?.[side]) actors[side].torso.rotation.z = (side === "p1" ? 1 : -1) * Math.max(0, wounds - 1) * 0.16;
}

export function lastStand(side) {
  if (!actors?.[side]) return;
  burst(actors[side].root.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff234f, 50);
}

export function finish(winner) {
  phase = "idle";
  if (winner === "p1" || winner === "p2") actors[winner].armR.rotation.z = winner === "p1" ? -2.7 : 2.7;
}
