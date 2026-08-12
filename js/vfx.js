// 원소 이펙트 9종을 셰이더로 그리는 연출 모듈. 판정 결과(fire/water/…)마다 전용 연출이 나간다.
// GLSL 노이즈·셰이딩 라이브러리는 LinearAbiltyCastingThreeJS(MIT, mohamedachrefelouafi)에서
// 가져와 다듬었다. 텍스처 없이 전부 수식으로 그리는 방식이라 에셋 0개 원칙이 유지된다.
import * as THREE from "three";

// ── 이식한 GLSL 라이브러리 (출처: LinearAbiltyCastingThreeJS/src/shaders/lib) ──
const NOISE_GLSL = `
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute289(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2 hash21(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289v3(i);
  vec4 p = permute289(permute289(permute289(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * snoise(p); p *= 2.02; a *= 0.5; }
  return v;
}

float ridged(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * (1.0 - abs(snoise(p))); p *= 2.06; a *= 0.5; }
  return v;
}

vec2 voronoi2(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash21(dot(n + g, vec2(7.13, 113.17)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < minDist) { minDist = d; id = hash11(dot(n + g, vec2(31.7, 57.1))); }
    }
  }
  return vec2(sqrt(minDist), id);
}

float fresnelTerm(vec3 viewDir, vec3 normal, float power, float scale) {
  return clamp(scale * pow(1.0 - abs(dot(normalize(viewDir), normalize(normal))), power), 0.0, 4.0);
}

vec3 gradient4(vec3 c0, vec3 c1, vec3 c2, vec3 c3, float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = mix(c0, c1, smoothstep(0.0, 0.34, t));
  vec3 b = mix(a, c2, smoothstep(0.30, 0.68, t));
  return mix(b, c3, smoothstep(0.64, 1.0, t));
}
`;

const VERTEX = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vUv = uv;
  vNormal = normalMatrix * normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

function shaderMat(fragBody, extraUniforms = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uSeed: { value: Math.random() * 100 }, ...extraUniforms },
    vertexShader: VERTEX,
    fragmentShader: NOISE_GLSL + `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      uniform float uTime;
      uniform float uFade;
      uniform float uSeed;
      ${fragBody}
    `,
  });
}

function additive(color, opacity = 0.9) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export function initVFX({ scene, tween }) {
  // 잠깐 살다 사라지는 것들의 공통 처리: 씬에 넣고, 수명이 끝나면 정리한다.
  function live(group, duration, update) {
    scene.add(group);
    return tween(duration, (eased, linear) => update(eased, linear)).then(() => {
      group.traverse((node) => {
        if (node.isMesh || node.isPoints || node.isLine) {
          node.geometry.dispose();
          node.material.dispose();
        }
      });
      scene.remove(group);
    });
  }

  // 짧은 섬광. 원소 색의 빛이 무대와 캐릭터를 실제로 비춘다.
  function flash(at, color, strength, duration = 500) {
    const light = new THREE.PointLight(color, strength, 6, 1.6);
    light.position.copy(at).add(new THREE.Vector3(0, 0.6, 0));
    scene.add(light);
    tween(duration, (eased) => { light.intensity = strength * (1 - eased); })
      .then(() => scene.remove(light));
  }

  // JS로 움직이는 입자 무리. init이 시작 상태를, step이 매 프레임 위치를 정한다.
  function particles(at, count, color, size, duration, init, step) {
    const positions = new Float32Array(count * 3);
    const seeds = Array.from({ length: count }, (_, i) => init(i));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    points.position.copy(at);
    const group = new THREE.Group();
    group.add(points);
    return live(group, duration, (eased, linear) => {
      for (let i = 0; i < count; i += 1) {
        const p = step(seeds[i], linear);
        positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
      }
      geometry.attributes.position.needsUpdate = true;
      points.material.opacity = 0.9 * (1 - eased * eased);
    });
  }

  const FX = {
    // 🔥 화염 기둥 — ridged 노이즈가 위로 흐르며 불꽃 필라멘트를 만든다
    fire(at, k) {
      const flame = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22 + k * 0.06, 0.5 + k * 0.1, 1.5 + k * 0.3, 14, 8, true),
        shaderMat(`
          void main() {
            float n = ridged(vec3(vUv.x * 5.0 + uSeed, vUv.y * 2.5 - uTime * 3.2, uSeed));
            float body = pow(1.0 - vUv.y, 1.4);
            float a = smoothstep(0.35, 0.95, n * (0.55 + body)) * body * uFade;
            vec3 col = gradient4(vec3(1.0, 0.98, 0.75), vec3(1.0, 0.72, 0.15),
                                 vec3(0.95, 0.28, 0.05), vec3(0.35, 0.03, 0.01), vUv.y + n * 0.2);
            gl_FragColor = vec4(col, a);
          }
        `),
      );
      flame.position.copy(at).add(new THREE.Vector3(0, 0.2, 0));
      const group = new THREE.Group();
      group.add(flame);
      flash(at, 0xff7a2a, 2.2 + k, 700);
      particles(at, 14 + k * 6, 0xffb347, 0.06, 900,
        (i) => ({ a: Math.random() * Math.PI * 2, r: 0.15 + Math.random() * 0.35, v: 1.2 + Math.random() * 1.4, w: 2 + Math.random() * 4 }),
        (s, t) => ({ x: Math.cos(s.a + t * s.w) * s.r, y: 0.2 + t * s.v * 1.6, z: Math.sin(s.a + t * s.w) * s.r }));
      return live(group, 850, (eased, linear) => {
        flame.material.uniforms.uTime.value = linear * 0.85;
        flame.material.uniforms.uFade.value = Math.sin(Math.min(1, linear * 1.15) * Math.PI);
        flame.scale.setScalar(0.7 + linear * 0.5);
      });
    },

    // 🌊 물기둥과 퍼지는 파문
    water(at, k) {
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3 + k * 0.07, 0.42 + k * 0.08, 1.7, 14, 6, true),
        shaderMat(`
          void main() {
            float n = snoise(vec3(vUv.x * 6.0 + uSeed, vUv.y * 3.0 - uTime * 4.0, uSeed)) * 0.5 + 0.5;
            float a = smoothstep(0.3, 0.85, n) * (1.0 - vUv.y * 0.6) * uFade * 0.8;
            vec3 col = gradient4(vec3(0.95, 1.0, 1.0), vec3(0.45, 0.85, 1.0),
                                 vec3(0.1, 0.5, 1.0), vec3(0.02, 0.2, 0.6), vUv.y);
            gl_FragColor = vec4(col, a);
          }
        `),
      );
      column.position.copy(at).add(new THREE.Vector3(0, 0.4, 0));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 8, 32), additive(0x66ccff, 0.8));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(at).setY(0.05);
      const group = new THREE.Group();
      group.add(column, ring);
      flash(at, 0x35a7ff, 1.6 + k * 0.6, 600);
      particles(at, 12 + k * 6, 0xaadfff, 0.05, 800,
        () => ({ a: Math.random() * Math.PI * 2, r: 0.2 + Math.random() * 0.5, v: 1.4 + Math.random() }),
        (s, t) => ({ x: Math.cos(s.a) * s.r * (0.5 + t), y: Math.max(0.05, t * s.v * 1.7 - 2.2 * t * t), z: Math.sin(s.a) * s.r * (0.5 + t) }));
      return live(group, 800, (eased, linear) => {
        column.material.uniforms.uTime.value = linear * 0.8;
        column.material.uniforms.uFade.value = Math.sin(Math.min(1, linear * 1.2) * Math.PI);
        ring.scale.setScalar(1 + eased * (2 + k * 0.6));
        ring.material.opacity = 0.8 * (1 - eased);
      });
    },

    // ⚡ 하늘에서 내리꽂는 지그재그 낙뢰
    lightning(at, k) {
      const group = new THREE.Group();
      const boltMat = additive(0xfff9c9, 1);
      const bolts = [];
      for (let b = 0; b < 1 + k; b += 1) {
        const bolt = new THREE.Group();
        let from = new THREE.Vector3(at.x + (Math.random() - 0.5) * 0.8, 4.4, at.z + (Math.random() - 0.5) * 0.4);
        const steps = 7;
        for (let s = 1; s <= steps; s += 1) {
          const to = s === steps
            ? at.clone().add(new THREE.Vector3(0, 0.9, 0))
            : new THREE.Vector3(at.x + (Math.random() - 0.5) * 1.1, 4.4 - (s / steps) * 3.4, at.z + (Math.random() - 0.5) * 0.7);
          const length = from.distanceTo(to);
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, length, 5), boltMat.clone());
          seg.position.copy(from).add(to).multiplyScalar(0.5);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
          bolt.add(seg);
          from = to;
        }
        bolt.visible = b === 0;
        bolts.push(bolt);
        group.add(bolt);
      }
      flash(at, 0xf4e84a, 3 + k, 450);
      return live(group, 520, (eased, linear) => {
        // 볼트가 번갈아 깜빡이며 진짜 방전처럼 보인다
        const active = Math.floor(linear * 14) % bolts.length;
        bolts.forEach((bolt, index) => {
          bolt.visible = index === active && Math.sin(linear * 60) > -0.6;
          bolt.children.forEach((seg) => { seg.material.opacity = 1 - eased * 0.9; });
        });
      });
    },

    // 🍃 상승 나선 회오리
    wind(at, k) {
      const group = new THREE.Group();
      const hoops = [];
      for (let i = 0; i < 3; i += 1) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.45 + i * 0.16, 0.03, 6, 24), additive(0xb9f3df, 0.55));
        hoop.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
        hoop.position.copy(at).setY(0.3 + i * 0.35);
        hoops.push(hoop);
        group.add(hoop);
      }
      particles(at, 30 + k * 10, 0xd2fbe9, 0.05, 900,
        (i) => ({ a: (i / 8) * Math.PI * 2, r: 0.55 + Math.random() * 0.3, v: 5 + Math.random() * 3 }),
        (s, t) => ({ x: Math.cos(s.a + t * s.v) * s.r * (1 - t * 0.5), y: t * 2.4, z: Math.sin(s.a + t * s.v) * s.r * (1 - t * 0.5) }));
      return live(group, 900, (eased, linear) => {
        hoops.forEach((hoop, index) => {
          hoop.rotation.z = linear * (6 + index * 2);
          hoop.position.y = 0.3 + index * 0.35 + linear * 1.4;
          hoop.material.opacity = 0.55 * (1 - eased);
          hoop.scale.setScalar(1 - eased * 0.35);
        });
      });
    },

    // 🪨 바위 파편 분출
    earth(at, k) {
      const group = new THREE.Group();
      const rock = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9, flatShading: true });
      const chunks = Array.from({ length: 5 + k * 2 }, () => {
        const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 + Math.random() * 0.11, 0), rock.clone());
        chunk.position.copy(at).setY(0.15);
        chunk.userData = {
          vx: (Math.random() - 0.5) * 1.8, vy: 2.2 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 1.2,
          rx: Math.random() * 8, rz: Math.random() * 8,
        };
        group.add(chunk);
        return chunk;
      });
      flash(at, 0xaa7744, 1.2 + k * 0.4, 500);
      particles(at, 16, 0xb59a72, 0.07, 700,
        () => ({ a: Math.random() * Math.PI * 2, r: 0.3 + Math.random() * 0.5 }),
        (s, t) => ({ x: Math.cos(s.a) * s.r * (0.4 + t * 1.6), y: 0.1 + t * 0.5, z: Math.sin(s.a) * s.r * (0.4 + t * 1.6) }));
      return live(group, 850, (eased, linear) => {
        for (const chunk of chunks) {
          const d = chunk.userData;
          chunk.position.set(
            at.x + d.vx * linear,
            Math.max(0.08, at.y + 0.15 + d.vy * linear - 4.6 * linear * linear),
            at.z + d.vz * linear,
          );
          chunk.rotation.x = d.rx * linear;
          chunk.rotation.z = d.rz * linear;
          chunk.material.opacity = 1;
          if (eased > 0.75) { chunk.material.transparent = true; chunk.material.opacity = 1 - (eased - 0.75) * 4; }
        }
      });
    },

    // 🛡 프레넬 림 + 보로노이 육각 문양이 흐르는 보호막 돔
    shield(at, k) {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.95 + k * 0.1, 28, 18),
        shaderMat(`
          void main() {
            float rim = fresnelTerm(vView, vNormal, 2.2, 1.2);
            vec2 vor = voronoi2(vUv * vec2(10.0, 6.0) + uTime * 0.4);
            float lines = smoothstep(0.09, 0.02, vor.x) * 0.5;
            float a = (rim * 0.55 + lines) * uFade;
            vec3 col = mix(vec3(0.3, 0.85, 1.0), vec3(0.85, 1.0, 1.0), rim * 0.5);
            gl_FragColor = vec4(col, a);
          }
        `),
      );
      dome.position.copy(at).add(new THREE.Vector3(0, 1.1, 0));
      const group = new THREE.Group();
      group.add(dome);
      flash(at, 0x72d7ff, 1.4, 700);
      return live(group, 1000, (eased, linear) => {
        dome.material.uniforms.uTime.value = linear;
        dome.material.uniforms.uFade.value = Math.sin(Math.min(1, linear * 1.1) * Math.PI);
        dome.scale.setScalar(0.6 + Math.min(1, linear * 3) * 0.4);
      });
    },

    // 💚 치유 — 땅의 빛 고리와 올라가는 생명 입자
    heal(at, k) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 8, 32), additive(0x7dff9f, 0.85));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(at).setY(0.06);
      const group = new THREE.Group();
      group.add(ring);
      flash(at, 0x5cff8d, 1.6 + k * 0.4, 800);
      particles(at, 18 + k * 6, 0xa5ffc0, 0.06, 1000,
        () => ({ a: Math.random() * Math.PI * 2, r: 0.2 + Math.random() * 0.45, v: 0.9 + Math.random() * 0.9 }),
        (s, t) => ({ x: Math.cos(s.a + t * 2) * s.r, y: 0.1 + t * s.v * 1.8, z: Math.sin(s.a + t * 2) * s.r }));
      return live(group, 1000, (eased) => {
        ring.scale.setScalar(1 + eased * 0.8);
        ring.position.y = 0.06 + eased * 1.2;
        ring.material.opacity = 0.85 * (1 - eased);
      });
    },

    // 🌑 어둠 — fbm으로 침식되는 그림자 구체와 빨려드는 보랏빛 입자
    dark(at, k) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.55 + k * 0.1, 24, 16),
        new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uSeed: { value: Math.random() * 100 } },
          vertexShader: VERTEX,
          fragmentShader: NOISE_GLSL + `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vView;
            uniform float uTime;
            uniform float uFade;
            uniform float uSeed;
            void main() {
              float n = fbm3(vec3(vUv * 5.0, uSeed + uTime * 1.6));
              float a = smoothstep(0.12, 0.65, n * 0.5 + 0.4) * uFade * 0.85;
              float rim = fresnelTerm(vView, vNormal, 2.0, 1.0);
              vec3 col = mix(vec3(0.03, 0.0, 0.08), vec3(0.45, 0.2, 0.85), rim + n * 0.25);
              gl_FragColor = vec4(col, a);
            }
          `,
        }),
      );
      orb.position.copy(at).add(new THREE.Vector3(0, 1.1, 0));
      const group = new THREE.Group();
      group.add(orb);
      particles(at, 20 + k * 6, 0x9a5cff, 0.06, 900,
        () => ({ a: Math.random() * Math.PI * 2, r: 1.3 + Math.random() * 0.8, h: 0.3 + Math.random() * 1.6 }),
        (s, t) => ({ x: Math.cos(s.a + t * 3) * s.r * (1 - t), y: s.h + (1.1 - s.h) * t, z: Math.sin(s.a + t * 3) * s.r * (1 - t) }));
      return live(group, 900, (eased, linear) => {
        orb.material.uniforms.uTime.value = linear;
        orb.material.uniforms.uFade.value = Math.sin(Math.min(1, linear * 1.15) * Math.PI);
        orb.rotation.y = linear * 4;
        orb.scale.setScalar(0.7 + linear * 0.6);
      });
    },

    // ✨ 빛 — 하늘에서 내려오는 빛기둥과 교차 광선
    light(at, k) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28 + k * 0.06, 0.34 + k * 0.06, 4.2, 16, 6, true),
        shaderMat(`
          void main() {
            float n = snoise(vec3(vUv.x * 8.0 + uSeed, vUv.y * 2.0 - uTime * 2.0, uSeed)) * 0.5 + 0.5;
            float a = (0.35 + n * 0.4) * (1.0 - abs(vUv.y - 0.45) * 1.3) * uFade * 0.9;
            vec3 col = gradient4(vec3(1.0), vec3(1.0, 0.98, 0.8), vec3(1.0, 0.9, 0.55), vec3(0.9, 0.7, 0.3), vUv.x);
            gl_FragColor = vec4(col, a);
          }
        `),
      );
      pillar.position.copy(at).add(new THREE.Vector3(0, 2.1, 0));
      const group = new THREE.Group();
      group.add(pillar);
      flash(at, 0xfff3b0, 2.4 + k, 800);
      particles(at, 16 + k * 5, 0xfff7cc, 0.06, 900,
        () => ({ a: Math.random() * Math.PI * 2, r: 0.25 + Math.random() * 0.4, v: 0.8 + Math.random() }),
        (s, t) => ({ x: Math.cos(s.a) * s.r, y: 2.4 - t * s.v * 2.2, z: Math.sin(s.a) * s.r }));
      return live(group, 900, (eased, linear) => {
        pillar.material.uniforms.uTime.value = linear;
        pillar.material.uniforms.uFade.value = Math.sin(Math.min(1, linear * 1.2) * Math.PI);
        pillar.scale.x = pillar.scale.z = 0.5 + Math.min(1, linear * 2.5) * 0.5;
      });
    },
  };

  return {
    // 판정 이펙트 하나를 재생한다. 모르는 타입은 조용히 넘어간다 (기존 파티클이 대신 나간다).
    spawn(type, at, intensity = 1) {
      const fx = FX[type];
      if (!fx) return null;
      return fx(at.clone().setY(0), Math.max(1, Math.min(3, intensity)));
    },
  };
}
