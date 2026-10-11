import * as THREE from "three";

/**
 * LVLH attitude as a quaternion in scene axes: body +x = velocity (radial part removed),
 * +y = zenith, +z = x × y. For a prograde orbit +z is the starboard side, i.e. opposite the
 * orbit normal h = r × v. Writes into `out` and uses `scratch` (3 vectors) to avoid allocation.
 */
export function lvlhQuaternion(
  pos: THREE.Vector3,
  velDir: THREE.Vector3,
  out: THREE.Quaternion,
  scratch: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  basis = new THREE.Matrix4(),
): THREE.Quaternion {
  const [up, fwd, stb] = scratch;
  up.copy(pos).normalize();
  fwd.copy(velDir).addScaledVector(up, -velDir.dot(up)).normalize();
  stb.crossVectors(fwd, up);
  return out.setFromRotationMatrix(basis.makeBasis(fwd, up, stb));
}
