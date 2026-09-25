import * as THREE from "three";
import { GLYPH_LAYER } from "../config";
import type { Layout } from "../machine/layout";
import { nativeApi } from "./bridge";

const FPS = 15;
const SUPERSAMPLE = 3; // render at 3x the matrix size, then average each 3x3 block into one LED
const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize(); // classic isometric: 45 deg around, ~35 deg up

/**
 * Streams a small isometric render of the part to the phone's Glyph Matrix (native app only).
 * A dedicated orthographic camera sees only GLYPH_LAYER (the stock chunks) lit by its own light,
 * so top / front / side faces get clearly different LED brightness. The tool position blinks.
 */
export class GlyphFeed {
  private api = nativeApi();
  private acc = 0;
  private blink = 0;
  private readyCheck = 0;
  private ready = false;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  private target: THREE.WebGLRenderTarget | null = null;
  private pixels = new Uint8Array(0);
  private prevClear = new THREE.Color();
  private tmp = new THREE.Vector3();
  private center = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.cam.layers.set(GLYPH_LAYER);
    if (!this.api) return;
    // Key light from top-front-left: top face brightest, front mid, right side darkest.
    const key = new THREE.DirectionalLight("#ffffff", 3.4);
    key.position.set(-0.35, 1, 0.55);
    const fill = new THREE.AmbientLight("#ffffff", 0.35);
    for (const l of [key, fill]) {
      l.layers.set(GLYPH_LAYER);
      scene.add(l);
    }
  }

  update(dt: number, renderer: THREE.WebGLRenderer, scene: THREE.Scene, layout: Layout, tip: THREE.Vector3) {
    const api = this.api;
    if (!api) return;
    this.acc += dt;
    this.blink += dt;
    this.readyCheck -= dt;
    if (this.readyCheck <= 0) {
      this.readyCheck = 1;
      this.ready = api.glyphReady();
    }
    if (!this.ready || this.acc < 1 / FPS) return;
    this.acc = 0;

    const N = api.glyphSize() || 13;
    const S = N * SUPERSAMPLE;
    if (!this.target || this.target.width !== S) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(S, S);
      this.pixels = new Uint8Array(S * S * 4);
    }

    this.frameStock(layout);

    const prevTarget = renderer.getRenderTarget();
    const prevBg = scene.background;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.prevClear);
    scene.background = null;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.cam);
    renderer.readRenderTargetPixels(this.target, 0, 0, S, S, this.pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.prevClear, prevAlpha);
    scene.background = prevBg;

    const out = new Array<number>(N * N);
    const px = this.pixels;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        let sum = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy++) {
          // readPixels rows start at the bottom; matrix rows start at the top.
          const y = S - 1 - (r * SUPERSAMPLE + sy);
          for (let sx = 0; sx < SUPERSAMPLE; sx++) {
            const i = (y * S + c * SUPERSAMPLE + sx) * 4;
            sum += (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
          }
        }
        const lum = sum / (SUPERSAMPLE * SUPERSAMPLE);
        // Render target holds linear light; sqrt is a cheap perceptual curve for the LEDs.
        out[r * N + c] = Math.min(255, Math.round(Math.sqrt(lum) * 340));
      }
    }

    // Tool marker: blink ~3 Hz, inverted so it shows on bright and dark faces alike.
    const p = this.tmp.copy(tip).project(this.cam);
    const tc = Math.floor(((p.x + 1) / 2) * N);
    const tr = Math.floor(((1 - p.y) / 2) * N);
    if (tc >= 0 && tr >= 0 && tc < N && tr < N && Math.floor(this.blink * 6) % 2 === 0) {
      const i = tr * N + tc;
      out[i] = out[i] > 128 ? 0 : 255;
    }
    api.glyphFrame(out.join(","));
  }

  /** Aim the iso camera at the stock and fit its projected corners inside the round matrix. */
  private frameStock(layout: Layout) {
    const { min, size } = layout;
    this.center.copy(min).addScaledVector(size, 0.5);
    this.cam.position.copy(this.center).addScaledVector(ISO_DIR, 1000);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.center);
    this.cam.updateMatrixWorld();
    let r = 0;
    for (let i = 0; i < 8; i++) {
      this.tmp.set(min.x + (i & 1 ? size.x : 0), min.y + (i & 2 ? size.y : 0), min.z + (i & 4 ? size.z : 0));
      this.tmp.applyMatrix4(this.cam.matrixWorldInverse);
      r = Math.max(r, Math.hypot(this.tmp.x, this.tmp.y));
    }
    const half = r * 1.04;
    this.cam.left = -half;
    this.cam.right = half;
    this.cam.top = half;
    this.cam.bottom = -half;
    this.cam.updateProjectionMatrix();
  }
}
