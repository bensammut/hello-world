import * as THREE from "three";
import { COLORS, MACHINE, type ToolSpec } from "../config";

const V = (x: number, y: number) => new THREE.Vector2(x, y);

function cutterProfile(tool: ToolSpec, d: number, top: number, tip: number): THREE.Vector2[] {
  const R = d / 2;
  const tan = (deg: number) => Math.tan(((deg / 2) * Math.PI) / 180);
  switch (tool.id) {
    case "flat":
      return [V(0, top), V(R, top), V(R, tip), V(0, tip)];
    case "ball": {
      const pts = [V(0, top), V(R, top), V(R, tip + R)];
      for (let i = 1; i <= 6; i++) {
        const a = (i / 6) * (Math.PI / 2);
        pts.push(V(R * Math.cos(a), tip + R - R * Math.sin(a)));
      }
      return pts;
    }
    case "vbit": {
      const coneH = R / tan(tool.coneDeg ?? 90);
      return [V(0, top), V(R, top), V(R, tip + coneH), V(0, tip)];
    }
    case "drill": {
      const coneH = R / tan(tool.coneDeg ?? 118);
      return [V(0, top), V(R, top), V(R, tip + coneH), V(0, tip)];
    }
    case "engrave": {
      const shank = 1.5;
      const coneH = (shank - 0.08) / tan(tool.coneDeg ?? 30);
      return [V(0, top), V(shank, top), V(shank, tip + coneH), V(0.08, tip), V(0, tip)];
    }
    case "face":
      return [V(0, top), V(R, top), V(R, tip), V(0, tip)];
  }
}

/** Lathe geometry with alternating helical stripes so spinning is visible after quantisation. */
function stripedLathe(points: THREE.Vector2[], flutes: number, light: string, dark: string) {
  const geo = new THREE.LatheGeometry(points, 12).toNonIndexed();
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const cl = new THREE.Color(light);
  const cd = new THREE.Color(dark);
  const stripes = Math.max(2, flutes * 2);
  for (let t = 0; t < pos.count; t += 3) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) {
      x += pos.getX(t + k);
      y += pos.getY(t + k);
      z += pos.getZ(t + k);
    }
    const ang = Math.atan2(z, x) + Math.PI + y * 0.22; // helix twist
    const sector = Math.floor((ang / (Math.PI * 2)) * stripes);
    const c = ((sector % 2) + 2) % 2 === 0 ? cl : cd;
    for (let k = 0; k < 3; k++) c.toArray(colors, (t + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

const lambert = (color: string) => new THREE.MeshLambertMaterial({ color });
const matCache = new Map<string, THREE.Material>();
function mat(color: string) {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = lambert(color)));
  return m;
}
const stripeMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/**
 * Tool assembly with its origin at the top of the holder ring (the point that
 * meets the spindle nose), hanging down to the tip at y = -stickout.
 */
export function buildToolAssembly(tool: ToolSpec, diameter: number): THREE.Group {
  const g = new THREE.Group();
  g.name = `tool-${tool.id}`;
  const L = tool.stickout;
  const ringH = MACHINE.rack.ringHeight;

  const ring = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, ringH, 12), mat(tool.color));
  ring.position.y = -ringH / 2;
  ring.name = "holder";
  g.add(ring);

  const nut = new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 7, 6), mat(COLORS.steelLight));
  nut.position.y = -ringH - 3.5;
  nut.name = "holder";
  g.add(nut);

  const nutBottom = -ringH - 7;
  const R = diameter / 2;
  const fluteLen = tool.id === "face" ? 9 : Math.min(tool.maxDepth + 4, L + nutBottom - 3);
  const cutterTop = -L + fluteLen;

  const shankR = tool.id === "face" ? 8 : tool.id === "engrave" ? 1.5 : Math.max(R, 1.5);
  const shankLen = cutterTop - nutBottom;
  if (shankLen < -0.01) {
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(shankR, shankR, -shankLen, 10), mat(COLORS.steel));
    shank.position.y = (nutBottom + cutterTop) / 2;
    g.add(shank);
  }

  const cutter = new THREE.Mesh(
    stripedLathe(cutterProfile(tool, diameter, cutterTop, -L), tool.flutes, COLORS.steelLight, COLORS.carbide),
    stripeMat,
  );
  g.add(cutter);

  if (tool.id === "face") {
    for (let i = 0; i < tool.flutes; i++) {
      const a = (i / tool.flutes) * Math.PI * 2;
      const insert = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), mat("#ffe07a"));
      insert.position.set(Math.cos(a) * (R - 1.2), -L + 1.5, Math.sin(a) * (R - 1.2));
      insert.rotation.y = -a;
      g.add(insert);
    }
  }
  return g;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}
