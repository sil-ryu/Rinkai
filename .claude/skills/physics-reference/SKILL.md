---
name: physics-reference
description: Constants, formulas, units and test values for orbital, satellite, relativistic and tidal physics in Rinkai. Use when writing or changing any physics or orbit-propagation code.
paths: frontend/src/physics/**, backend/app/physics/**
user-invocable: false
---
Constants: G=6.67430e-11, c=299792458, AU=1.495978707e11 m, GM_sun=1.32712440018e20 m^3/s^2, GM_earth=3.986004418e14 m^3/s^2, R_earth(equatorial)=6378137 m.
Kepler: M = E - e*sin(E); solve E by Newton-Raphson (tol 1e-12, max 50 iterations; start E=M, or pi if e>0.8). Support e<1 only; handle e>=1 explicitly.
Satellites: SGP4 via satellite.js from OMM; output is TEME (km). Convert TEME -> ECEF -> geodetic with GMST; keep the frame in variable names (posTemeKm, posEcefM).
ISS OEM: CCSDS OEM, EME2000/J2000 frame, km and km/s; interpolate with 8-point Lagrange or Hermite (uses velocities).
Schwarzschild radius r_s = 2GM/c^2. Photon sphere 1.5 r_s. ISCO 3 r_s (non-rotating).
Static-observer time dilation dtau/dt = sqrt(1 - r_s/r); undefined for r <= r_s (return an explicit "inside horizon" state, never NaN).
Tidal acceleration across length L: 2GM*L/r^3. Fluid Roche limit: ~2.44 * R_primary * (rho_primary/rho_satellite)^(1/3).
Sanity values: Sun r_s ~ 2953 m; Earth r_s ~ 8.87 mm; Earth orbital period 365.25 d within tolerance; ISS period ~92-93 min.
Never hardcode a formula result in a test; derive expected values independently or from reference data.
