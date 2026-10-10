/** Solve Kepler's equation M = E - e sin E for the eccentric anomaly E (radians). Elliptical orbits only. */
export function solveKepler(meanAnomaly: number, e: number, tol = 1e-12, maxIter = 50): number {
  if (!(e >= 0 && e < 1)) {
    throw new RangeError(
      `solveKepler supports 0 <= e < 1 (got e=${e}); parabolic/hyperbolic orbits need another solver`,
    );
  }
  const M = wrapPi(meanAnomaly);
  let E = e > 0.8 ? Math.PI * Math.sign(M || 1) : M;
  for (let i = 0; i < maxIter; i++) {
    const f = E - e * Math.sin(E) - M;
    const dE = f / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < tol) return E;
  }
  throw new Error(`solveKepler did not converge (M=${meanAnomaly}, e=${e})`);
}

export function trueAnomalyFromEccentric(E: number, e: number): number {
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

/** Orbital period (s) from semi-major axis (m) and gravitational parameter (m^3/s^2). */
export function orbitalPeriod(a: number, mu: number): number {
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

function wrapPi(x: number): number {
  const twoPi = 2 * Math.PI;
  return x - twoPi * Math.floor((x + Math.PI) / twoPi);
}
