# PIXEL MILL

A playful, pixel-art simulator of a compact high-speed gantry CNC mill. Carve a
voxel block of aluminium by dragging the mouse, swap between six cutters with
an automatic tool change, and export the result as an STL.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle in dist/
```

Everything runs client-side (Vite + TypeScript + Three.js, no UI framework).

**Live:** https://bensammut.github.io/hello-world/pixel-mill/play/

GitHub Pages serves this repo's `main` branch as-is, so the deployed build is
committed in `play/`. To update it, run `npm run build:pages`, then commit and
push `play/`.

## Controls

| Input | Action |
| --- | --- |
| Left drag | Move the tool / cut (the tool follows your drawn path at feed rate) |
| Shift + drag | Lock to a straight line along X or Y |
| Wheel | Depth, 0.5 mm steps (also `-` / `=` and the DEPTH slider) |
| Space | Toggle plunge mode: the tool drops to depth only while the button is held |
| Right drag / Alt + drag | Orbit camera |
| Middle drag / Alt + Shift + drag | Pan camera |
| Ctrl + wheel / pinch | Zoom |
| `T` `F` `S` `I` | Camera presets: top / front / side / iso |
| `1`–`6` | Select tool (plays the automatic tool change) |
| `[` `]` | Tool diameter down / up |
| Ctrl + Z, Ctrl + Shift + Z (or Ctrl + Y) | Undo / redo a stroke (24 steps) |
| Ctrl + S, Ctrl + O | Save / open project |
| `B` | Blow off chips |
| `M` | Sound on / off (off by default) |
| `?` | Shortcut overlay |

**Contour mode** (default): the tool stays at depth after you release, so the
next drag nearby continues the cut. Starting a drag somewhere else makes the
machine retract, travel and plunge instead of gouging a path there.
**Plunge mode**: the tool retracts whenever the button is up. The **drill** is
always plunge-only: click and hold to drill; dragging is ignored.

The orange ring is the target (ghost cursor). When you move faster than the
feed rate, the tool lags behind along your path, like a real machine. The tool
refuses to enter the vise jaws and flashes a **VISE COLLISION** warning.

## Tools

| # | Tool | Kernel | Notes |
| --- | --- | --- | --- |
| 1 | Flat end mill Ø2/4/6/10 | Cylinder, flat bottom | Pockets and walls |
| 2 | Ball end mill Ø2/4/6/10 | Hemispherical tip | Smooth contours |
| 3 | V-bit 90° | Cone, width grows with depth | Chamfers, V-grooves |
| 4 | Twist drill 118° | Cylinder + point | Plunge only |
| 5 | Face mill Ø16/20/25 | Large flat disc, max 2 mm deep | Levelling |
| 6 | Engraving bit 30° | Fine cone, max 1 mm deep | Lines and lettering |

Every tool is a solid of revolution defined by one profile function
(`profileRadius` in `src/tools/kernels.ts`). The sweep removes every voxel
within the profile radius of the swept segment, so fast moves never leave gaps.

## Architecture

```
src/
  config.ts              all tunables: grid, palette, tool specs, machine layout, camera presets
  App.ts                 wires modules together; frame loop (update → remesh → effects → render)
  state/store.ts         tiny observable store for UI-facing state
  voxel/VoxelGrid.ts     flat Uint8Array grid, 16³ chunk dirty-tracking, per-stroke undo snapshots
  voxel/greedyMesher.ts  greedy meshing per chunk (each chunk owns its voxels' faces)
  voxel/ChunkMeshes.ts   one mesh per chunk, remeshes dirty chunks within a time budget
  tools/kernels.ts       tool profiles + swept-capsule carving
  tools/toolMeshes.ts    procedural tool models with striped flutes
  machine/layout.ts      stock/vise/rack placement, obstacle tests
  machine/MotionController.ts  feed-limited path following, retract/travel/plunge, collision
  machine/ToolChanger.ts eased tool-change sequence
  machine/MachineModel.ts procedural enclosure, gantry, spindle, vise, rack, stack light
  render/PixelRenderer.ts low-res target → outline + Bayer dither + 32-colour quantise → integer upscale
  render/CameraRig.ts    orbit/pan/zoom camera with eased presets
  render/GhostCursor.ts  target ring
  input/InputController.ts mouse/keyboard → actions
  effects/Particles.ts   chips (flying, piled, blown off) and coolant mist as 1-pixel points
  audio/SoundEngine.ts   Web Audio spindle whine + cutting noise, no audio files
  ui/                    DOM panels, pixel sprites, styles
  io/projectFile.ts      save/load JSON with deflate-compressed voxels
  io/stlExport.ts        binary STL, one quad per exposed voxel face (watertight)
```

**Pixel pipeline:** the scene renders to a render target about 180 rows tall.
A low-res pass adds depth-based silhouette outlines and ordered 4×4 Bayer
dithering, then snaps every pixel to the 32-colour palette. A final pass scales
that up to the canvas by an integer factor with nearest-neighbour sampling.
The UI uses the same palette.

**Voxels:** 128×48×96 by default at 0.5 mm (a 64×48×24 mm block), configurable
in `config.ts` and through NEW stock (up to 200×80×160 voxels). Removing a
voxel tags its solid neighbours as "cut", so machined faces render brighter and
darken with depth, which makes top-down views read like a depth map.

## Performance

Measured in the dev browser on a Mac. A 25 mm face-mill raster and a deep
10 mm pocket cost about 1 ms per frame at p50 and 2 ms at p99 on the CPU
(motion + carving + remeshing). The pixel render takes about 2 ms. Greedy meshing
on the main thread with a 7 ms budget is enough, so there is no worker.

## Known limitations

- Undo history is not saved in project files, and loading or creating new stock clears it.
- The tool body only collides with the vise jaws. The rack and other machine
  parts are outside the travel limits instead of being modelled as obstacles.
- The STL has one quad per voxel face (about 100k triangles for the default block),
  with a stair-stepped surface at 0.5 mm resolution.
- Chips are cosmetic. Piled chips fall again if the surface under them is machined away.
- Audio is synthesised and only approximates a real spindle.

## Licences

Fonts: Press Start 2P and VT323 (SIL Open Font License), bundled through
`@fontsource`. The machine design, sprites and palette are original and not
based on any manufacturer's branding.
