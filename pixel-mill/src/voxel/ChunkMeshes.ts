import * as THREE from "three";
import { COLORS, GLYPH_LAYER, VOXEL_MM } from "../config";
import { meshChunk, type MaterialColors } from "./greedyMesher";
import type { VoxelGrid } from "./VoxelGrid";

function linear(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/** Owns one THREE.Mesh per non-empty chunk and remeshes dirty chunks within a time budget. */
export class ChunkMeshes {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private material: THREE.MeshPhongMaterial;
  private colors: MaterialColors = [[0, 0, 0], linear(COLORS.stock), linear(COLORS.stockCut)];
  private grid: VoxelGrid;
  lastRemeshCount = 0;
  lastRemeshMs = 0;
  /** World Y of the original stock top; machined faces darken with depth below it. */
  private depthUniforms = { uTop: { value: 0 }, uRange: { value: 14 } };

  constructor(grid: VoxelGrid) {
    this.grid = grid;
    this.material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      specular: new THREE.Color("#5a6273"),
      shininess: 38,
    });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.depthUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aCut;\nvarying float vCut;\nvarying float vWorldY;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvCut = aCut;\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTop;\nuniform float uRange;\nvarying float vCut;\nvarying float vWorldY;")
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.1, vCut * clamp((uTop - vWorldY) / uRange, 0.0, 1.0)); // linear space, so strong",
        );
    };
    this.group.scale.setScalar(VOXEL_MM);
    this.group.name = "stock";
  }

  setStockTop(y: number, heightMm: number) {
    this.depthUniforms.uTop.value = y;
    this.depthUniforms.uRange.value = Math.max(4, Math.min(7, heightMm * 0.4));
  }

  setGrid(grid: VoxelGrid) {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.meshes.clear();
    this.grid = grid;
  }

  /** Remesh dirty chunks until the budget runs out; the rest wait for the next frame. */
  update(budgetMs: number) {
    const dirty = this.grid.dirty;
    if (dirty.size === 0) {
      this.lastRemeshCount = 0;
      return;
    }
    const t0 = performance.now();
    let n = 0;
    for (const id of dirty) {
      dirty.delete(id);
      this.remesh(id);
      n++;
      if (performance.now() - t0 > budgetMs) break;
    }
    this.lastRemeshCount = n;
    this.lastRemeshMs = performance.now() - t0;
  }

  flush() {
    this.update(Infinity);
  }

  private remesh(id: number) {
    const data = meshChunk(this.grid, id, this.colors);
    const existing = this.meshes.get(id);
    if (!data) {
      if (existing) {
        existing.geometry.dispose();
        this.group.remove(existing);
        this.meshes.delete(id);
      }
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute("aCut", new THREE.BufferAttribute(data.cut, 1));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geo;
    } else {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.layers.enable(GLYPH_LAYER);
      mesh.matrixAutoUpdate = false;
      this.meshes.set(id, mesh);
      this.group.add(mesh);
    }
  }

  get meshCount() {
    return this.meshes.size;
  }

  triangleCount() {
    let t = 0;
    for (const m of this.meshes.values()) t += (m.geometry.index?.count ?? 0) / 3;
    return t;
  }
}
