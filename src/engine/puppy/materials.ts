import * as THREE from 'three'
import type { FurParams } from '@/domain/breeds'

export interface FurUniforms {
  uFurLen: { value: number }
  uDroop: { value: number }
  uComb: { value: number }
  uDensity: { value: number }
  /** Mud at the roots and, a little lighter, at the tips. */
  uMud: { value: THREE.Color }
  uMudTip: { value: THREE.Color }
}

const MUD = new THREE.Color('#4a2f1b'),
  MUD_TIP = new THREE.Color('#6b4a2e')

export function furUniforms(f: FurParams): FurUniforms {
  return {
    uFurLen: { value: f.fur },
    uDroop: { value: f.droop },
    uComb: { value: f.comb },
    uDensity: { value: f.density },
    uMud: { value: MUD },
    uMudTip: { value: MUD_TIP },
  }
}

/**
 * One shell of layered fur at height `h` (0 is the skin). Each shell pushes the skin out along
 * its normal, droops and combs it back, and keeps only the cells of the strands that reach it.
 * The `dirt` attribute (0 to 1 per vertex) tints it mud brown, most on the outer shells, and
 * clumps the strands shorter where it is thick.
 */
export function furMaterial(h: number, u: FurUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
  const uH = { value: h }
  m.userData.uH = uH
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uH })
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float furLen; attribute float dirt; varying vec3 vRest; varying float vFur; varying float vDirt;
uniform float uH, uFurLen, uDroop, uComb;`,
      )
      .replace(
        '#include <skinning_vertex>',
        `#include <skinning_vertex>
vRest = position; vFur = furLen; vDirt = dirt;
float fl = furLen * uFurLen * uH * (1.0 - 0.35 * smoothstep(0.6, 1.0, dirt));
transformed += normalize(objectNormal) * fl;
transformed += vec3(0.0, -uDroop, -uComb) * fl * uH;`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRest; varying float vFur; varying float vDirt; uniform float uH, uDensity;
uniform vec3 uMud, uMudTip;
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 q = vRest * uDensity; vec3 cell = floor(q);
  vec3 f = fract(q) - 0.5 - (h33(cell) - 0.5) * 0.5;
  float strand = 0.6 + 0.4 * h13(cell + 11.0);
  if (uH > 0.0 && (vFur < 0.03 || uH > strand || length(f) > 0.62 * (1.0 - uH / strand) + 0.04)) discard;
  float caked = clamp(vDirt * (0.7 + 0.3 * uH) * (0.75 + 0.5 * h13(cell + 7.0)), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(uMud, uMudTip, uH), caked);
  diffuseColor.rgb *= mix(0.5, 1.04, smoothstep(0.0, 1.0, uH)) * (0.9 + 0.2 * h13(cell + 3.0));
}`,
      )
  }
  m.customProgramCacheKey = () => 'fur-v2'
  return m
}

/** Moves a shell to height `h` without compiling it again. */
export function setFurHeight(m: THREE.Material, h: number): void {
  ;(m.userData.uH as { value: number }).value = h
}

export function eyeMaterial(map: THREE.Texture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map,
    roughness: 0.45,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 0.45,
  })
}

export function lidMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })
}

export function noseMaterial(color: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    vertexColors: true,
    roughness: 0.55,
    clearcoat: 0.45,
    clearcoatRoughness: 0.35,
  })
}

export function tongueMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.4,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    emissive: '#3a0d16',
    side: THREE.DoubleSide,
  })
}

export function glintMaterial(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity,
    toneMapped: false,
    depthWrite: false,
  })
}
