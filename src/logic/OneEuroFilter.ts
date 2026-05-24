import * as THREE from 'three';

/**
 * Adaptive low-pass filter (1-Euro Filter) designed for 3D spatial joint coordinates.
 * Dynamically adjusts cutoff frequency based on velocity magnitude to remove high-frequency
 * tremor jitter when stationary, and eliminate lag during rapid motions.
 */
export class OneEuroFilter {
  private firstTime = true;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  
  private xPrev = new THREE.Vector3();
  private dxPrev = new THREE.Vector3();

  constructor(minCutoff = 0.8, beta = 0.05, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(dt: number, cutoff: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return dt / (dt + tau);
  }

  public filter(x: THREE.Vector3, dt: number): THREE.Vector3 {
    if (this.firstTime) {
      this.firstTime = false;
      this.xPrev.copy(x);
      this.dxPrev.set(0, 0, 0);
      return x.clone();
    }

    if (dt <= 0) return this.xPrev.clone();

    // 1. Calculate velocity magnitude
    const dx = new THREE.Vector3().subVectors(x, this.xPrev).divideScalar(dt);
    
    // 2. Filter velocity to obtain smooth motion speed
    const alphaV = this.alpha(dt, this.dCutoff);
    this.dxPrev.lerp(dx, alphaV);

    // 3. Dynamic cutoff frequency based on current physical speed
    const speed = this.dxPrev.length();
    const cutoff = this.minCutoff + this.beta * speed;

    // 4. Apply dynamic cutoff to filter the final coordinate vector
    const alphaX = this.alpha(dt, cutoff);
    this.xPrev.lerp(x, alphaX);

    return this.xPrev.clone();
  }
}
