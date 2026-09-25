import * as THREE from "three";
import { PALETTE, PIXEL } from "../config";

function srgbPalette(): THREE.Vector3[] {
  return PALETTE.map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  });
}

const fullscreenVert = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Pass 1 (low-res): depth outline + ordered dither + nearest-palette quantisation.
const quantizeFrag = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform vec3 uPalette[${PALETTE.length}];
  uniform float uDither;
  uniform float uOutline;
  uniform float uNear;
  uniform float uFar;

  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  float viewDepth(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return -perspectiveDepthToViewZ(d, uNear, uFar);
  }

  vec3 toSRGB(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
  }

  void main() {
    vec2 px = floor(gl_FragCoord.xy);
    vec2 uv = (px + 0.5) / uRes;
    vec3 c = toSRGB(texture2D(tColor, uv).rgb);

    if (uOutline > 0.5) {
      float d = viewDepth(uv);
      vec2 o = 1.0 / uRes;
      float m = max(max(viewDepth(uv + vec2(o.x, 0.0)), viewDepth(uv - vec2(o.x, 0.0))),
                    max(viewDepth(uv + vec2(0.0, o.y)), viewDepth(uv - vec2(0.0, o.y))));
      // Silhouette pixel: a neighbour is much further away than we are.
      if (m - d > max(4.0, d * 0.06)) c *= 0.38;
    }

    c += (bayer4(px) - 0.5) * uDither;

    vec3 best = uPalette[0];
    float bestD = 1e9;
    for (int i = 0; i < ${PALETTE.length}; i++) {
      vec3 diff = (c - uPalette[i]) * vec3(0.9, 1.2, 0.7);
      float dd = dot(diff, diff);
      if (dd < bestD) { bestD = dd; best = uPalette[i]; }
    }
    gl_FragColor = vec4(best, 1.0);
  }
`;

// Pass 2 (screen): integer nearest-neighbour upscale.
const blitFrag = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uRes;
  uniform float uScale;
  void main() {
    vec2 px = floor(gl_FragCoord.xy / uScale);
    gl_FragColor = vec4(texture2D(tSrc, (px + 0.5) / uRes).rgb, 1.0);
  }
`;

/**
 * Renders the scene into a small render target, quantises it to the palette at
 * that resolution, then upscales to the canvas by an integer factor.
 */
const PORTRAIT_FOV = import.meta.env.MODE === "android";

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  lowW = 320;
  lowH = 180;
  scale = 1;
  private baseFov: number | undefined;
  private sceneTarget!: THREE.WebGLRenderTarget;
  private quantTarget!: THREE.WebGLRenderTarget;
  private quantMat: THREE.ShaderMaterial;
  private blitMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.quantMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: quantizeFrag,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uRes: { value: new THREE.Vector2() },
        uPalette: { value: srgbPalette() },
        uDither: { value: PIXEL.dither },
        uOutline: { value: PIXEL.outline ? 1 : 0 },
        uNear: { value: 1 },
        uFar: { value: 1000 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blitMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: blitFrag,
      uniforms: { tSrc: { value: null }, uRes: { value: new THREE.Vector2() }, uScale: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quantMat);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);
  }

  set dither(on: boolean) {
    this.quantMat.uniforms.uDither.value = on ? PIXEL.dither : 0;
  }
  set outline(on: boolean) {
    this.quantMat.uniforms.uOutline.value = on ? 1 : 0;
  }

  resize(cssW: number, cssH: number, camera: THREE.PerspectiveCamera) {
    this.renderer.setSize(cssW, cssH, false);
    const dpr = this.renderer.getPixelRatio();
    const devW = Math.max(1, Math.floor(cssW * dpr));
    const devH = Math.max(1, Math.floor(cssH * dpr));
    this.scale = Math.max(1, Math.round(devH / PIXEL.targetRows));
    this.lowW = Math.ceil(devW / this.scale);
    this.lowH = Math.ceil(devH / this.scale);

    this.sceneTarget?.dispose();
    this.quantTarget?.dispose();
    const opts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    this.sceneTarget = new THREE.WebGLRenderTarget(this.lowW, this.lowH, {
      ...opts,
      depthTexture: new THREE.DepthTexture(this.lowW, this.lowH),
    });
    this.quantTarget = new THREE.WebGLRenderTarget(this.lowW, this.lowH, { ...opts, depthBuffer: false });

    camera.aspect = this.lowW / this.lowH;
    if (PORTRAIT_FOV) {
      // Android portrait: widen the vertical FOV so a tall screen sees the same horizontal span.
      this.baseFov ??= camera.fov;
      const half = (this.baseFov * Math.PI) / 360;
      camera.fov = camera.aspect < 1 ? Math.min(80, (Math.atan(Math.tan(half) / camera.aspect) * 360) / Math.PI) : this.baseFov;
    }
    camera.updateProjectionMatrix();
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneTarget);
    r.render(scene, camera);

    const q = this.quantMat.uniforms;
    q.tColor.value = this.sceneTarget.texture;
    q.tDepth.value = this.sceneTarget.depthTexture;
    q.uRes.value.set(this.lowW, this.lowH);
    q.uNear.value = camera.near;
    q.uFar.value = camera.far;
    this.quad.material = this.quantMat;
    r.setRenderTarget(this.quantTarget);
    r.render(this.postScene, this.postCam);

    const b = this.blitMat.uniforms;
    b.tSrc.value = this.quantTarget.texture;
    b.uRes.value.set(this.lowW, this.lowH);
    b.uScale.value = this.scale;
    this.quad.material = this.blitMat;
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }
}
