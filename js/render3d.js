import * as THREE from "three";
import { initVFX } from "./vfx.js";

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
let vfx = null;        // 원소 이펙트 모듈 (vfx.js)

// 모션이 재생될 때마다 호출될 함수를 등록한다. 렌더러가 소리를 직접 다루지 않게 분리했다.
export function setMotionListener(fn) { onMotion = fn; }

// 현재 무대 상태. 필드 배경이 제대로 적용됐는지 확인할 때 쓴다.
export function stageState() {
  let bossColor = null;
  let bossMeshes = 0;
  const bossPalette = new Set();
  actors?.p2?.root.traverse((node) => {
    if (node.isMesh && node.material?.color) {
      bossMeshes += 1;
      bossPalette.add("#" + node.material.color.getHexString());
      if (!bossColor) bossColor = "#" + node.material.color.getHexString();
    }
  });
  return scene ? {
    background: "#" + scene.background.getHexString(),
    floor: "#" + floorMesh.material.color.getHexString(),
    motes: motes ? moteCount : 0,
    rain: Boolean(moteFall),
    bossColor,
    bossMeshes,
    bossPalette: [...bossPalette],
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

// 베기·받아치기의 칼자국. 반원 띠를 대각선으로 눕혀 휘두른 궤적처럼 보이게 한다.
function swingArc(at, direction, color) {
  const arc = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.055, 6, 20, Math.PI * 0.85),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  arc.position.copy(at).add(new THREE.Vector3(-direction * 0.3, 0.15, 0));
  arc.rotation.set(0, Math.PI / 2, direction * -0.9);
  scene.add(arc);
  tween(320, (eased) => {
    arc.material.opacity = 0.9 * (1 - eased);
    arc.scale.setScalar(1 + eased * 0.5);
  });
  return arc;
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
  } else if (motion === "slash") {
    // 베기: 팔을 머리 위로 들었다가 대각선으로 내리긋고, 궤적에 흰 호가 남는다.
    const startX = actor.root.position.x;
    await tween(160, (eased) => {
      actor.armR.rotation.z = -direction * (0.18 + eased * 2.9);   // 크게 치켜든다
      actor.torso.rotation.z = direction * eased * 0.2;
    });
    const arc = swingArc(destination, direction, 0xffffff);
    await tween(190, (eased) => {
      actor.root.position.x = startX + direction * eased * 1.2;
      actor.armR.rotation.z = -direction * (3.08 - eased * 4.2);   // 단숨에 내려친다
      actor.torso.rotation.z = direction * (0.2 - eased * 0.45);
    });
    burst(destination, 0xffffff, 20);
    scene.remove(arc);
    await tween(240, (eased) => { actor.root.position.x = startX + direction * (1 - eased) * 1.2; });

  } else if (motion === "stab") {
    // 찌르기: 몸을 낮추고 일직선으로 파고든다. 팔은 앞으로 곧게 뻗는다.
    const startX = actor.root.position.x;
    await tween(120, (eased) => {
      actor.torso.rotation.x = -eased * 0.32;                       // 자세를 낮춘다
      actor.armR.rotation.z = -direction * (0.18 + eased * 0.5);
    });
    await tween(140, (eased) => {
      actor.root.position.x = startX + direction * eased * 1.7;     // 더 깊고 빠르게
      actor.armR.rotation.z = -direction * (0.68 + eased * 0.92);
    });
    burst(destination, 0xdff2ff, 12);
    await tween(260, (eased) => {
      actor.root.position.x = startX + direction * (1 - eased) * 1.7;
      actor.torso.rotation.x = -(1 - eased) * 0.32;
    });

  } else if (motion === "punch_rush") {
    // 연타: 이동하지 않고 제자리에서 양팔을 교대로 빠르게 6번 뻗는다.
    const startX = actor.root.position.x;
    await tween(120, (eased) => { actor.root.position.x = startX + direction * eased * 0.7; });
    for (let i = 0; i < 6; i += 1) {
      const right = i % 2 === 0;
      await tween(85, (eased) => {
        const swing = Math.sin(eased * Math.PI) * 1.7;
        if (right) actor.armR.rotation.z = -direction * (0.18 + swing);
        else actor.armL.rotation.z = direction * (0.18 + swing);
      });
      burst(destination, 0xffffff, 7);
    }
    await tween(200, (eased) => { actor.root.position.x = startX + direction * (1 - eased) * 0.7; });

  } else if (motion === "kick") {
    // 발차기: 한 발로 서서 다리를 크게 차올린다. 팔은 균형을 잡는다.
    const startX = actor.root.position.x;
    await tween(150, (eased) => {
      actor.root.position.x = startX + direction * eased * 0.9;
      actor.torso.rotation.z = -direction * eased * 0.3;            // 상체를 젖혀 균형
      actor.armL.rotation.z = direction * eased * 1.5;
      actor.legR.rotation.z = -direction * eased * 2.3;             // 높이 차올린다
    });
    burst(destination, 0xfff0d0, 18);
    await tween(280, (eased) => {
      actor.root.position.x = startX + direction * (1 - eased) * 0.9;
      actor.legR.rotation.z = -direction * (1 - eased) * 2.3;
      actor.torso.rotation.z = -direction * (1 - eased) * 0.3;
    });

  } else if (motion === "counter") {
    // 받아치기: 막는 자세로 버틴 뒤 방패가 깨지며 그대로 반격으로 이어진다.
    actor.armL.rotation.z = direction * 1.25;
    actor.armR.rotation.z = -direction * 1.25;
    const guard = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 24),
      new THREE.MeshBasicMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    guard.position.copy(actor.root.position).add(new THREE.Vector3(direction * 0.55, 1.5, 0));
    guard.rotation.y = Math.PI / 2;
    scene.add(guard);
    await tween(220, (eased) => { guard.material.opacity = 0.55 - eased * 0.15; });
    burst(guard.position.clone(), 0x9ad0ff, 24);                    // 막아낸다
    await tween(140, (eased) => { guard.scale.setScalar(1 + eased * 1.6); guard.material.opacity = 0.4 * (1 - eased); });
    scene.remove(guard);
    const startX = actor.root.position.x;
    const arc = swingArc(destination, direction, 0xffe680);
    await tween(180, (eased) => {                                   // 곧바로 되받아친다
      actor.root.position.x = startX + direction * eased * 1.3;
      actor.armR.rotation.z = -direction * (1.25 + eased * 1.6);
    });
    burst(destination, 0xffe680, 26);
    scene.remove(arc);
    await tween(240, (eased) => { actor.root.position.x = startX + direction * (1 - eased) * 1.3; });

  } else if (motion === "grab_throw") {
    // 잡아 던지기: 파고들어 붙잡은 뒤, 상대를 머리 위로 넘겨 반대편에 내리꽂는다.
    const startX = actor.root.position.x;
    const targetStartX = target.root.position.x;
    await tween(200, (eased) => {
      actor.root.position.x = startX + direction * eased * 1.9;
      actor.armL.rotation.z = direction * eased * 1.7;
      actor.armR.rotation.z = -direction * eased * 1.7;
    });
    await tween(420, (eased) => {                                   // 포물선을 그리며 넘긴다
      target.root.position.x = targetStartX - direction * eased * 2.6;
      target.root.position.y = Math.sin(eased * Math.PI) * 1.5;
      target.root.rotation.z = direction * eased * Math.PI;
    });
    target.root.position.y = 0;
    target.root.rotation.z = 0;
    burst(target.root.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 0xffffff, 30);
    shakePower = 0.08;
    await tween(300, (eased) => {
      actor.root.position.x = startX + direction * (1 - eased) * 1.9;
      target.root.position.x = (targetStartX - direction * 2.6) + direction * eased * 2.6;
    });

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

function renderLoop(timestamp) {
  if (!running) return;
  requestAnimationFrame(renderLoop);
  clock.update(timestamp);
  const elapsed = clock.getElapsed();
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
    if (telegraph) {
      // 다음 기술을 준비하는 슬로우 모션 — 팔을 끌어올리며 몸 전체를 천천히 뒤로 젖힌다.
      // 팔이 짧은 보스(사과·파도)도 몸의 기울기로 준비 동작이 읽힌다.
      const windup = 0.5 + Math.sin(elapsed * 0.7) * 0.5;
      actors.p2.armR.rotation.z = 0.18 + windup * 1.1;
      actors.p2.armL.rotation.z = -0.18 - windup * 0.4;
      actors.p2.root.rotation.z = windup * 0.16;
      const base = actors.p2.root.position;
      for (let i = 0; i < telegraph.count; i += 1) {
        const angle = elapsed * 0.6 + (i / telegraph.count) * Math.PI * 2;
        telegraph.positions[i * 3] = base.x + Math.cos(angle) * 0.7;
        telegraph.positions[i * 3 + 1] = 1.15 + Math.sin(elapsed * 0.9 + i * 1.7) * 0.55;
        telegraph.positions[i * 3 + 2] = base.z + Math.sin(angle) * 0.7;
      }
      telegraph.aura.geometry.attributes.position.needsUpdate = true;
      telegraph.aura.material.opacity = 0.35 + windup * 0.3;
    }
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
  vfx = initVFX({ scene, tween });
  resizeObserver = new ResizeObserver(resizeToContainer);
  resizeObserver.observe(target);
  resizeToContainer();
  clock = new THREE.Timer();
  if (!running) { running = true; renderLoop(); }
}

export function setActors() {}
export function setPhase(nextPhase) {
  phase = nextPhase;
  if (nextPhase !== "typing") clearTelegraph();   // 입력이 끝나면 예고 동작도 멈춘다
}

// ── 다음 기술 예고 ─────────────────────────────────────────────
// 플레이어가 문장을 쓰는 동안, 보스는 다음 기술을 슬로우 모션으로 준비한다.
// 원소색 기운이 몸 주위를 돌아 "무엇이 올지"가 화면에서도 읽힌다.
let telegraph = null;

export function setTelegraph(element) {
  clearTelegraph();
  if (!scene || !actors?.p2 || !element) return;
  // 원소색을 흰색 쪽으로 끌어올려 어두운 필드에서도 확실히 읽히게 한다
  const color = new THREE.Color(EFFECT_COLORS[element] ?? 0xffffff).lerp(new THREE.Color(0xffffff), 0.35);
  const count = 14;
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const aura = new THREE.Points(geometry, new THREE.PointsMaterial({
    color, size: 0.14, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(aura);
  telegraph = { aura, positions, count };
}

function clearTelegraph() {
  if (!telegraph) return;
  scene.remove(telegraph.aura);
  telegraph.aura.geometry.dispose();
  telegraph.aura.material.dispose();
  telegraph = null;
  if (actors?.p2) actors.p2.root.rotation.z = 0;   // 젖혔던 몸을 되돌린다
}

// 보스의 몸 색을 그 보스의 색으로 물들인다. 무지개 보스는 색이 곧 정체성이다.
export function setBossColor(hex) {
  if (!actors?.p2 || hex == null) return;
  actors.p2.root.traverse((node) => {
    if (node.isMesh && node.material?.color) node.material.color.setHex(hex);
  });
}

// ── 무지개 보스 전용 몸체 ──────────────────────────────────────
// 마네킹 대신 그 보스의 생김새를 도형으로 빚는다. 관절 이름(root/torso/head/armL…)은
// 사람형과 똑같이 유지해서, 기존 전투 모션이 어떤 몸에서도 그대로 재생된다.

function std(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.12, ...options });
}

function put(parent, geometry, material, x = 0, y = 0, z = 0) {
  const node = new THREE.Mesh(geometry, material);
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

// 공통 골격: 비어 있는 관절 그룹을 만들고, 각 빌더가 그 안에 살을 붙인다.
function bossSkeleton() {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const joints = { root, torso, head: new THREE.Group() };
  joints.head.position.y = 2.35;
  torso.add(joints.head);
  for (const [name, x, y] of [["armL", -0.55, 1.7], ["armR", 0.55, 1.7], ["legL", -0.2, 1.0], ["legR", 0.2, 1.0]]) {
    const joint = new THREE.Group();
    joint.position.set(x, y, 0);
    torso.add(joint);
    joints[name] = joint;
  }
  return joints;
}

const BOSS_BUILDERS = {
  1(hex) {   // 🍎 홍옥 — 커다란 사과. 꼭지와 잎이 머리, 짧은 팔다리로 buzzing
    const joints = bossSkeleton();
    const apple = std(hex);
    const body = put(joints.torso, new THREE.SphereGeometry(0.72, 20, 16), apple, 0, 1.25, 0);
    body.scale.y = 0.92;
    joints.head.position.y = 2.0;
    put(joints.head, new THREE.CylinderGeometry(0.05, 0.08, 0.3, 8), std(0x6b4423), 0, 0.15, 0);
    const leaf = put(joints.head, new THREE.SphereGeometry(0.16, 10, 8), std(0x34c759), 0.18, 0.28, 0);
    leaf.scale.set(1.4, 0.5, 0.7);
    for (const side of [joints.armL, joints.armR]) put(side, new THREE.SphereGeometry(0.13, 10, 8), apple, 0, -0.05, 0);
    for (const side of [joints.legL, joints.legR]) put(side, new THREE.CapsuleGeometry(0.09, 0.2, 4, 8), apple, 0, -0.2, 0);
    return joints;
  },
  2(hex) {   // 🐯 호걸 — 줄무늬와 귀, 꼬리가 있는 호랑이
    const joints = bossSkeleton();
    const fur = std(hex);
    const dark = std(0x2c1a0e);
    put(joints.torso, new THREE.CapsuleGeometry(0.34, 0.7, 6, 12), fur, 0, 1.5, 0);
    for (const y of [1.3, 1.55, 1.8]) {
      const stripe = put(joints.torso, new THREE.TorusGeometry(0.35, 0.035, 6, 16), dark, 0, y, 0);
      stripe.rotation.x = Math.PI / 2;
    }
    put(joints.head, new THREE.SphereGeometry(0.32, 16, 12), fur, 0, 0, 0);
    put(joints.head, new THREE.SphereGeometry(0.15, 10, 8), std(0xfff2e0), 0, -0.08, 0.24);
    for (const x of [-0.2, 0.2]) put(joints.head, new THREE.ConeGeometry(0.1, 0.18, 6), dark, x, 0.3, 0);
    for (const side of [joints.armL, joints.armR]) {
      put(side, new THREE.CapsuleGeometry(0.1, 0.45, 4, 8), fur, 0, -0.25, 0);
      put(side, new THREE.SphereGeometry(0.12, 8, 6), dark, 0, -0.55, 0);
    }
    for (const side of [joints.legL, joints.legR]) put(side, new THREE.CapsuleGeometry(0.12, 0.6, 4, 8), fur, 0, -0.35, 0);
    const tail = put(joints.torso, new THREE.CapsuleGeometry(0.06, 0.7, 4, 8), fur, -0.35, 1.35, -0.25);
    tail.rotation.z = 1.0;
    return joints;
  },
  3(hex) {   // 🍌 미끌 — 초승달처럼 휜 바나나
    const joints = bossSkeleton();
    const peel = std(hex);
    const segments = [[-0.28, 1.1, -0.5], [-0.1, 1.5, -0.25], [0.05, 1.85, 0.05], [0.12, 2.15, 0.35]];
    for (const [x, y, tilt] of segments) {
      const piece = put(joints.torso, new THREE.CapsuleGeometry(0.2, 0.34, 6, 10), peel, x, y, 0);
      piece.rotation.z = tilt;
    }
    joints.head.position.set(0.16, 2.4, 0);
    put(joints.head, new THREE.CylinderGeometry(0.07, 0.1, 0.18, 8), std(0x6b4423), 0, 0, 0);
    for (const side of [joints.armL, joints.armR]) put(side, new THREE.CapsuleGeometry(0.08, 0.3, 4, 8), peel, 0, -0.18, 0);
    for (const side of [joints.legL, joints.legR]) put(side, new THREE.SphereGeometry(0.1, 8, 6), std(0x6b4423), 0, -0.15, 0);
    return joints;
  },
  4(hex) {   // 🥦 브록 장군 — 줄기 위에 꽃송이 구름
    const joints = bossSkeleton();
    const stalk = std(0x9adf78);
    const crown = std(hex);
    put(joints.torso, new THREE.CylinderGeometry(0.22, 0.34, 1.1, 10), stalk, 0, 1.35, 0);
    joints.head.position.y = 2.25;
    put(joints.head, new THREE.SphereGeometry(0.42, 14, 10), crown, 0, 0, 0);
    for (const [x, y, z] of [[-0.35, 0.12, 0.1], [0.35, 0.1, -0.1], [0, 0.3, 0.28], [-0.15, 0.28, -0.28], [0.2, 0.32, 0.15]]) {
      put(joints.head, new THREE.SphereGeometry(0.24, 10, 8), crown, x, y, z);
    }
    for (const side of [joints.armL, joints.armR]) put(side, new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), stalk, 0, -0.22, 0);
    for (const side of [joints.legL, joints.legR]) put(side, new THREE.CapsuleGeometry(0.1, 0.4, 4, 8), stalk, 0, -0.25, 0);
    return joints;
  },
  5(hex) {   // 🌊 해일 — 반투명한 물의 파도, 꼭대기에 흰 물거품
    const joints = bossSkeleton();
    const water = std(hex, { transparent: true, opacity: 0.72, roughness: 0.2 });
    const foam = std(0xeaf8ff, { transparent: true, opacity: 0.9 });
    const body = put(joints.torso, new THREE.SphereGeometry(0.62, 18, 14), water, 0, 1.3, 0);
    body.scale.set(0.85, 1.5, 0.85);
    const base = put(joints.torso, new THREE.CylinderGeometry(0.85, 1.0, 0.22, 16), water, 0, 0.12, 0);
    base.material = water;
    joints.head.position.y = 2.3;
    for (const [x, z, r] of [[0, 0, 0.2], [-0.22, 0.1, 0.14], [0.2, -0.08, 0.15], [0.05, 0.2, 0.11]]) {
      put(joints.head, new THREE.SphereGeometry(r, 10, 8), foam, x, 0.05, z);
    }
    for (const side of [joints.armL, joints.armR]) put(side, new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), water, 0, -0.28, 0);
    return joints;   // 다리는 없다. 파도는 걷지 않는다
  },
  6(hex) {   // 🌌 미리내 — 어두운 밤의 장막에 별이 박혀 있다
    const joints = bossSkeleton();
    const night = std(hex, { transparent: true, opacity: 0.85, roughness: 0.8 });
    const star = new THREE.MeshBasicMaterial({ color: 0xfff7cf });
    const cloak = put(joints.torso, new THREE.ConeGeometry(0.62, 1.9, 12), night, 0, 1.15, 0);
    cloak.scale.z = 0.8;
    put(joints.head, new THREE.SphereGeometry(0.3, 16, 12), night, 0, 0, 0);
    for (const [x, y, z, r] of [[-0.3, 1.0, 0.35, 0.045], [0.25, 1.5, 0.4, 0.06], [-0.15, 1.9, 0.42, 0.04], [0.35, 0.7, 0.3, 0.05], [0.05, 1.25, 0.48, 0.05]]) {
      put(joints.torso, new THREE.SphereGeometry(r, 6, 5), star, x, y, z);
    }
    put(joints.head, new THREE.SphereGeometry(0.05, 6, 5), star, 0.15, 0.12, 0.24);
    for (const side of [joints.armL, joints.armR]) put(side, new THREE.CapsuleGeometry(0.07, 0.45, 4, 8), night, 0, -0.25, 0);
    return joints;
  },
  7(hex) {   // 🍇 포도대왕 — 포도알 무더기 위에 황금 왕관
    const joints = bossSkeleton();
    const grape = std(hex, { roughness: 0.35 });
    const gold = std(0xf5c542, { metalness: 0.6, roughness: 0.3 });
    const layers = [
      [0.6, [[-0.3, 0, 0.18], [0.3, 0, 0.18], [0, 0, -0.3], [-0.28, 0, -0.2], [0.28, 0, -0.2]]],
      [1.15, [[-0.25, 0, 0.2], [0.25, 0, 0.2], [0, 0, -0.25], [0, 0, 0.02]]],
      [1.65, [[-0.18, 0, 0.1], [0.18, 0, 0.1], [0, 0, -0.15]]],
    ];
    for (const [y, spots] of layers) {
      for (const [x, , z] of spots) put(joints.torso, new THREE.SphereGeometry(0.28, 12, 10), grape, x, y, z);
    }
    joints.head.position.y = 2.15;
    put(joints.head, new THREE.SphereGeometry(0.3, 14, 10), grape, 0, 0, 0);
    put(joints.head, new THREE.CylinderGeometry(0.22, 0.26, 0.16, 10), gold, 0, 0.32, 0);
    for (const angle of [0, 1.26, 2.51, 3.77, 5.03]) {
      put(joints.head, new THREE.ConeGeometry(0.05, 0.16, 4), gold, Math.cos(angle) * 0.2, 0.46, Math.sin(angle) * 0.2);
    }
    const leaf = put(joints.head, new THREE.SphereGeometry(0.14, 8, 6), std(0x34c759), -0.24, 0.2, 0);
    leaf.scale.set(1.3, 0.4, 0.8);
    for (const side of [joints.armL, joints.armR]) put(side, new THREE.CapsuleGeometry(0.09, 0.4, 4, 8), std(0x4b7a3a), 0, -0.22, 0);
    for (const side of [joints.legL, joints.legR]) put(side, new THREE.SphereGeometry(0.12, 8, 6), grape, 0, -0.18, 0);
    return joints;
  },
};

let bossShapeKey = null;

// p2 자리를 보스의 생김새로 갈아 끼운다. 모르는 보스나 온라인 상대(null)는 사람형으로 돌아간다.
export function setBossShape(bossId, hex) {
  if (!scene || !actors) return;
  const key = BOSS_BUILDERS[bossId] ? `boss-${bossId}` : `human-${hex ?? "default"}`;
  if (bossShapeKey === key) return;
  bossShapeKey = key;

  const wounds = actors.p2?.root.userData.wounds ?? 0;
  if (actors.p2) {
    scene.remove(actors.p2.root);
    actors.p2.root.traverse((node) => {
      if (node.isMesh) { node.geometry.dispose(); node.material.dispose(); }
    });
  }

  if (BOSS_BUILDERS[bossId]) {
    const joints = BOSS_BUILDERS[bossId](hex ?? COLORS.p2);
    joints.root.position.set(1.65, 0, 0);
    joints.root.rotation.y = -Math.PI / 2;
    joints.root.userData.homeX = 1.65;
    joints.root.userData.side = "p2";
    joints.root.userData.wounds = wounds;
    scene.add(joints.root);
    actors.p2 = joints;
  } else {
    actors.p2 = makeActor("p2");
    actors.p2.root.userData.wounds = wounds;
    if (hex != null) setBossColor(hex);
  }
  resetPose(actors.p2);
}

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
  clearTelegraph();
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
    if (!target) continue;
    burst(target, EFFECT_COLORS[effect.type] || 0xffffff, 12 + effect.intensity * 8);
    // 원소별 전용 연출 (셰이더 화염·낙뢰·보호막 돔 등). 실패해도 전투는 계속된다.
    try { vfx?.spawn(effect.type, actors[effect.target].root.position, effect.intensity); } catch { /* 파티클만으로 진행 */ }
  }
  for (const motion of motions) await animateMotion(motion);
  const cameraReturnStart = camera.position.clone();
  await tween(320, (eased) => camera.position.lerpVectors(cameraReturnStart, cameraStart, eased));
  phase = "typing";
  onDone();
}

// ── 무지개 반사 ───────────────────────────────────────────────
// 기를 모으고 → 일곱 빛깔 거울을 펼치고 → 그 빛을 상대에게 통째로 되돌려 보낸다.
const RAINBOW = [0xff2d2d, 0xff9130, 0xffe93b, 0x3fd45f, 0x35a7ff, 0x3f4bd4, 0x9b3fd4];

export async function rainbowReflect(side) {
  if (!scene || !actors?.[side]) return;
  const actor = actors[side];
  const target = actors[side === "p1" ? "p2" : "p1"];
  const direction = side === "p1" ? 1 : -1;
  const origin = actor.root.position.clone().add(new THREE.Vector3(0, 1.25, 0));
  const hit = target.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  const cameraStart = camera.position.clone();
  phase = "resolving";
  clearTelegraph();
  resetPose(actor);

  // 1. 두 팔을 들어 올리며 흰 빛의 핵을 모은다
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
  );
  core.position.copy(origin).add(new THREE.Vector3(direction * 0.45, 0, 0));
  core.scale.setScalar(0.01);
  scene.add(core);
  await tween(620, (eased, linear) => {
    actor.armL.rotation.z = -2.5 * eased;
    actor.armR.rotation.z = 2.5 * eased;
    actor.root.position.y = Math.sin(linear * Math.PI) * 0.12;
    core.scale.setScalar(0.05 + eased * 1.05);
    camera.position.lerpVectors(cameraStart, cameraStart.clone().setZ(5.4), eased);
  });

  // 2. 일곱 빛깔 거울이 펼쳐진다. 고리가 하나씩 시차를 두고 열린다.
  const mirror = new THREE.Group();
  mirror.position.copy(origin).add(new THREE.Vector3(direction * 0.6, 0, 0));
  mirror.rotation.y = direction * Math.PI * 0.5;
  scene.add(mirror);
  const rings = RAINBOW.map((color, index) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.34 + index * 0.15, 0.045, 8, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    mirror.add(ring);
    return ring;
  });
  await tween(560, (eased, linear) => {
    rings.forEach((ring, index) => {
      const local = Math.max(0, Math.min(1, (linear - index * 0.07) / 0.35));
      ring.material.opacity = local * 0.9;
      ring.scale.setScalar(0.2 + local * 0.8);
      ring.rotation.z = local * Math.PI * (index % 2 ? -1 : 1);
    });
    core.scale.setScalar(1.1 + Math.sin(linear * Math.PI * 4) * 0.25);
    shakePower = 0.02 * eased;
  });

  // 3. 빛줄기 일곱 갈래가 상대에게 쏟아진다
  await Promise.all(RAINBOW.map((color, index) =>
    new Promise((resolve) => setTimeout(() => {
      const from = origin.clone().add(new THREE.Vector3(direction * 0.6, (index - 3) * 0.13, 0));
      makeBeam(from, hit, color).then(resolve);
    }, index * 55)),
  ));

  // 4. 상대가 통째로 튕겨 나간다
  shakePower = 0.16;
  RAINBOW.forEach((color, index) => setTimeout(() => burst(hit, color, 26), index * 40));
  const knockFrom = target.root.position.clone();
  const knockTo = knockFrom.clone().add(new THREE.Vector3(direction * 1.5, 0, 0));
  await tween(700, (eased, linear) => {
    target.root.position.lerpVectors(knockFrom, knockTo, eased);
    target.root.position.y = Math.sin(linear * Math.PI) * 0.9;
    target.root.rotation.z = direction * eased * 2.2;
    rings.forEach((ring) => { ring.material.opacity = 0.9 * (1 - eased); ring.scale.multiplyScalar(1.02); });
    core.material.opacity = 1 - eased;
  });

  rings.forEach((ring) => { ring.geometry.dispose(); ring.material.dispose(); });
  scene.remove(mirror);
  core.geometry.dispose();
  core.material.dispose();
  scene.remove(core);
  await tween(360, (eased) => camera.position.lerpVectors(camera.position.clone(), cameraStart, eased));
  camera.position.copy(cameraStart);
  phase = "idle";
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
