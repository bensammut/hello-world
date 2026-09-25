import * as THREE from "three";
import { CAMERA_PRESETS, type CameraPresetName } from "../config";

interface Sph {
  theta: number;
  phi: number;
  radius: number;
}

/** Spherical orbit camera with damping. The target point can be panned. */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 2, 3000);
  readonly target = new THREE.Vector3();
  private home = new THREE.Vector3();
  private cur: Sph = { theta: 0, phi: 1, radius: 200 };
  private want: Sph = { theta: 0, phi: 1, radius: 200 };
  private wantTarget = new THREE.Vector3();

  /** Current polar angle (0 = looking straight down). */
  get polar() {
    return this.cur.phi;
  }

  setHome(p: THREE.Vector3) {
    this.home.copy(p);
    this.wantTarget.copy(p);
  }

  preset(name: CameraPresetName, instant = false) {
    const p = CAMERA_PRESETS[name];
    // Take the short way round so presets never spin a full turn.
    let theta = p.theta;
    while (theta - this.cur.theta > Math.PI) theta -= Math.PI * 2;
    while (theta - this.cur.theta < -Math.PI) theta += Math.PI * 2;
    this.want = { theta, phi: p.phi, radius: p.radius };
    this.wantTarget.copy(this.home).add(new THREE.Vector3(0, p.lift, -p.back));
    if (instant) {
      this.cur = { ...this.want };
      this.target.copy(this.wantTarget);
      this.apply();
    }
  }

  orbit(dxPx: number, dyPx: number) {
    this.want.theta -= dxPx * 0.008;
    this.want.phi = THREE.MathUtils.clamp(this.want.phi - dyPx * 0.008, 0.02, 1.52);
  }

  pan(dxPx: number, dyPx: number, viewHeightPx: number) {
    const worldPerPx = (2 * this.cur.radius * Math.tan((this.camera.fov * Math.PI) / 360)) / viewHeightPx;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.wantTarget.addScaledVector(right, -dxPx * worldPerPx).addScaledVector(up, dyPx * worldPerPx);
  }

  zoom(delta: number) {
    this.want.radius = THREE.MathUtils.clamp(this.want.radius * Math.exp(delta * 0.0015), 40, 900);
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 14);
    this.cur.theta += (this.want.theta - this.cur.theta) * k;
    this.cur.phi += (this.want.phi - this.cur.phi) * k;
    this.cur.radius += (this.want.radius - this.cur.radius) * k;
    this.target.lerp(this.wantTarget, k);
    this.apply();
  }

  private apply() {
    const { theta, phi, radius } = this.cur;
    const s = Math.sin(phi);
    this.camera.position.set(
      this.target.x + radius * s * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * s * Math.cos(theta),
    );
    // Near-vertical views need a stable up vector, otherwise lookAt flips.
    this.camera.up.set(-Math.sin(theta) * Math.cos(phi), Math.sin(phi), -Math.cos(theta) * Math.cos(phi));
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
