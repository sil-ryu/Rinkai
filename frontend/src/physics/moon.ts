import { DEG, J2000_JD, R_EARTH_EQ_KM } from "./constants";
import { julianDate, type Vec3 } from "./frames";

const sinD = (x: number) => Math.sin(x * DEG);
const cosD = (x: number) => Math.cos(x * DEG);

/**
 * Geocentric Moon position (km) in the equatorial frame of date, from the Astronomical Almanac
 * low-precision formulae (~0.3 deg in direction, ~0.3% in distance over 1950-2050;
 * ~0.08 deg / 0.1% against JPL Horizons in the tests).
 */
export function moonPositionInertial(date: Date): Vec3 {
  const T = (julianDate(date) - J2000_JD) / 36525;
  const lambda =
    218.32 +
    481267.881 * T +
    6.29 * sinD(135.0 + 477198.87 * T) -
    1.27 * sinD(259.3 - 413335.36 * T) +
    0.66 * sinD(235.7 + 890534.22 * T) +
    0.21 * sinD(269.9 + 954397.74 * T) -
    0.19 * sinD(357.5 + 35999.05 * T) -
    0.11 * sinD(186.5 + 966404.03 * T);
  const beta =
    5.13 * sinD(93.3 + 483202.02 * T) +
    0.28 * sinD(228.2 + 960400.89 * T) -
    0.28 * sinD(318.3 + 6003.15 * T) -
    0.17 * sinD(217.6 - 407332.21 * T);
  const parallax =
    0.9508 +
    0.0518 * cosD(135.0 + 477198.87 * T) +
    0.0095 * cosD(259.3 - 413335.36 * T) +
    0.0078 * cosD(235.7 + 890534.22 * T) +
    0.0028 * cosD(269.9 + 954397.74 * T);
  const r = R_EARTH_EQ_KM / sinD(parallax);
  const eps = 23.439 - 0.0000004 * (julianDate(date) - J2000_JD);
  const x = cosD(beta) * cosD(lambda);
  const y = cosD(beta) * sinD(lambda);
  const z = sinD(beta);
  return {
    x: r * x,
    y: r * (y * cosD(eps) - z * sinD(eps)),
    z: r * (y * sinD(eps) + z * cosD(eps)),
  };
}

/** Illuminated fraction of the Moon's disc (0 = new, 1 = full) from Sun and Moon directions. */
export function moonIlluminatedFraction(moon: Vec3, sunDir: Vec3): number {
  const n = Math.hypot(moon.x, moon.y, moon.z);
  const cosElong = (moon.x * sunDir.x + moon.y * sunDir.y + moon.z * sunDir.z) / n;
  return (1 - cosElong) / 2;
}
