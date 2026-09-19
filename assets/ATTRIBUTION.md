# 3D body models - attribution

The 3D body map (`/scan/body`, the spot history map, and the tracked-spot card preview) draws one
of two human meshes, picked from the user's profile sex with an override under
Settings → Body figure (`src/lib/body-variant.ts`). Both were downloaded from Sketchfab as `.glb`.

The `.glb` files are **build inputs, not shipped assets** - nothing `require()`s them.
`npm run bake:body` (`scripts/bake-body-geometry.mjs`) extracts the vertex positions and triangle
indices into `src/components/scan/body-geometry.<variant>.ts`, which is what the app bundles. The
bake drops the textures, UVs and materials; the app draws both meshes in a single flat colour.

> ⚠️ **`female_base_mesh.glb` is licensed CC BY-NC 4.0 (NonCommercial).** That rules it out for a
> paid or otherwise commercial release. Get a commercial licence from the author or replace it
> with a CC BY / CC0 mesh before production. To replace it, drop the new `.glb` in and update
> `MESHES` in `scripts/bake-body-geometry.mjs`, then run `npm run bake:body` and
> `npm run test:regions`. The runtime normalises units, orientation, centring and height, so no
> app code should need changing - the test confirms the region mapping still holds for the new pose.

| File | Used as | Source | Licence | Author |
|------|---------|--------|---------|--------|
| `male_base_model.glb` | Male figure | [Male Base Model](https://sketchfab.com/3d-models/male-base-model-c613f570ecda43628018e78ef932b89d) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [gome70](https://sketchfab.com/gome70) |
| `female_base_mesh.glb` | Female figure | [Female_Base Mesh](https://sketchfab.com/3d-models/female-base-mesh-8efc5215df5e48c5866753916749bbe5) | ⚠️ [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | [prajwaltp9](https://sketchfab.com/prajwaltp9) |

Both licences require attribution. Credit the models on the in-app licenses screen when that
screen is built, the same way `REFERENCE_IMAGE_CREDITS` (`src/lib/triage/reference-images.ts`) is
meant to be credited there.

`body.glb` in this folder is an unreferenced 7.5 MB copy of `male_base_model.glb`, left over from
before the rename.
