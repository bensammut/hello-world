import * as THREE from "three";
import { COLORS } from "../config";

/** Ring + crosshair marking where the mouse wants the tool to go. */
export class GhostCursor {
  readonly group = new THREE.Group();
  private ring: THREE.LineLoop;
  private cross: THREE.LineSegments;
  private stem: THREE.Line;
  private mat = new THREE.LineBasicMaterial({ color: COLORS.ghost, depthTest: false, transparent: true });

  constructor() {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    this.ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.mat);
    this.cross = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-3, 0, 0), new THREE.Vector3(3, 0, 0),
        new THREE.Vector3(0, 0, -3), new THREE.Vector3(0, 0, 3),
      ]),
      this.mat,
    );
    this.stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]),
      this.mat,
    );
    this.group.add(this.ring, this.cross, this.stem);
    this.group.renderOrder = 10;
    for (const c of this.group.children) c.renderOrder = 10;
  }

  /** stemHeight < 0 draws the depth tick down into the stock. */
  update(x: number, y: number, z: number, radius: number, active: boolean, visible: boolean, stemHeight: number) {
    this.group.visible = visible;
    this.group.position.set(x, y, z);
    const r = Math.max(0.6, radius);
    this.ring.scale.set(r, 1, r);
    this.stem.scale.set(1, Math.abs(stemHeight) < 0.01 ? 0.01 : stemHeight, 1);
    this.mat.color.set(active ? COLORS.ghost : COLORS.ghostIdle);
    this.mat.opacity = active ? 1 : 0.7;
  }
}
