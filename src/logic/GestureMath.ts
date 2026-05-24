import * as THREE from 'three';
import { OneEuroFilter } from './OneEuroFilter';

export class GestureMath {
  private lastTime: number = 0;


  // Smoothing states
  private smoothedWrist = new THREE.Vector3();
  private smoothedIndex = new THREE.Vector3();
  private smoothedThumb = new THREE.Vector3();

  // One Euro Filter for pointing direction vector
  private directionFilter = new OneEuroFilter(0.08, 0.03, 1.0);

  // Stability/Grace period states
  private lastPinchTime: number = 0;
  private isPinchingState: boolean = false;
  private readonly PINCH_GRACE_PERIOD = 500; // ms

  // Fixed ergonomic pivot for the wand root (bottom-right of the screen)
  public readonly WAND_PIVOT = new THREE.Vector3(1.4, 0.8, 2.5);

  // Last targeted object index for hysteresis
  private lastTargetIdx = -1;

  // Depth perception tracking properties
  private baselineScale: number = -1;
  private depthSpellState: 'none' | 'accio' | 'repulso' = 'none';

  /**
   * Maps MediaPipe normalized coords [0,1] to 3D space using the highly fluid flat-plane projection.
   */
  public mapTo3D(normalizedX: number, normalizedY: number, zDepth: number = 0): THREE.Vector3 {
    const aspect = window.innerWidth / window.innerHeight;
    const frustumHeight = 10; 
    const frustumWidth = frustumHeight * aspect;

    // Mirrored camera coordinate projection
    const x = ((1.0 - normalizedX) - 0.5) * frustumWidth;
    const y = -(normalizedY - 0.5) * frustumHeight;
    
    return new THREE.Vector3(x, y, zDepth);
  }

  public calculateRotation(wrist: THREE.Vector3, indexTip: THREE.Vector3): THREE.Quaternion {
    const direction = new THREE.Vector3().subVectors(indexTip, wrist).normalize();
    const defaultForward = new THREE.Vector3(0, 0, 1);
    return new THREE.Quaternion().setFromUnitVectors(defaultForward, direction);
  }

  /**
   * Detects if only the Index finger is extended while Middle, Ring, and Pinky are folded.
   * This is a traditional pointing/aiming pose that transitions beautifully with Fist and peace sign.
   */
  public checkSingleFingerPoint(allLandmarks: any[] | null): boolean {
    if (!allLandmarks || allLandmarks.length <= 20) return false;

    const wrist = allLandmarks[0];
    if (!wrist) return false;

    // Index (8) should be extended
    const tipIndex = allLandmarks[8];
    const baseIndex = allLandmarks[5];
    if (!tipIndex || !baseIndex) return false;

    const distTipIndex = Math.sqrt(Math.pow(tipIndex.x - wrist.x, 2) + Math.pow(tipIndex.y - wrist.y, 2));
    const distBaseIndex = Math.sqrt(Math.pow(baseIndex.x - wrist.x, 2) + Math.pow(baseIndex.y - wrist.y, 2));

    if (distTipIndex < distBaseIndex * 1.3) {
      return false;
    }

    // Middle (12), Ring (16), Pinky (20) should be folded
    const foldedFingers = [12, 16, 20];
    const bases: Record<number, number> = {
      12: 9,
      16: 13,
      20: 17
    };

    for (const tip of foldedFingers) {
      const tipL = allLandmarks[tip];
      const baseL = allLandmarks[bases[tip]];
      if (!tipL || !baseL) return false;

      const distTip = Math.sqrt(Math.pow(tipL.x - wrist.x, 2) + Math.pow(tipL.y - wrist.y, 2));
      const distBase = Math.sqrt(Math.pow(baseL.x - wrist.x, 2) + Math.pow(baseL.y - wrist.y, 2));

      // Curled finger tips should be folded inward
      if (distTip > distBase * 1.15) {
        return false;
      }
    }

    return true;
  }

  /**
   * Refined Leviosa trigger using the Single-Finger Point gesture with a grace period for stability.
   */
  public checkPinch(allLandmarks: any[] | null, timestamp: number): boolean {
    const isPhysicallyPointing = this.checkSingleFingerPoint(allLandmarks);
    
    if (isPhysicallyPointing) {
      this.lastPinchTime = timestamp;
      this.isPinchingState = true;
    } else {
      // Grace period before dropping the hover state to handle flickering tracking
      if (timestamp - this.lastPinchTime > this.PINCH_GRACE_PERIOD) {
        this.isPinchingState = false;
      }
    }
    
    return this.isPinchingState;
  }

  /**
   * Detects if the hand is clenched in a fist by checking if index, middle, ring, and pinky
   * tips are folded closer to the wrist than their respective base joints.
   */
  public checkFist(allLandmarks: any[] | null): boolean {
    if (!allLandmarks || allLandmarks.length <= 20) return false;

    const wrist = allLandmarks[0];
    if (!wrist) return false;

    // Finger tip and base pairs: Index (8, 5), Middle (12, 9), Ring (16, 13), Pinky (20, 17)
    const fingers = [
      { tip: 8, base: 5 },
      { tip: 12, base: 9 },
      { tip: 16, base: 13 },
      { tip: 20, base: 17 }
    ];

    let foldedCount = 0;
    for (const f of fingers) {
      const tipL = allLandmarks[f.tip];
      const baseL = allLandmarks[f.base];

      if (tipL && baseL) {
        const distTip = Math.sqrt(Math.pow(tipL.x - wrist.x, 2) + Math.pow(tipL.y - wrist.y, 2));
        const distBase = Math.sqrt(Math.pow(baseL.x - wrist.x, 2) + Math.pow(baseL.y - wrist.y, 2));

        if (distTip < distBase * 1.15) {
          foldedCount++;
        }
      }
    }

    // If at least 3 out of 4 fingers are curled, it's a solid fist
    return foldedCount >= 3;
  }

  /**
   * Detects if only the Index and Middle fingers are extended, while the Ring and Pinky
   * fingers are folded (a traditional spell-bolt / two-finger gesture).
   */
  public checkTwoFingerPoint(allLandmarks: any[] | null): boolean {
    if (!allLandmarks || allLandmarks.length <= 20) return false;

    const wrist = allLandmarks[0];
    if (!wrist) return false;

    // Index (8) and Middle (12) should be extended
    const extendedFingers = [8, 12];
    // Ring (16) and Pinky (20) should be folded
    const foldedFingers = [16, 20];

    const bases: Record<number, number> = {
      8: 5,
      12: 9,
      16: 13,
      20: 17
    };

    // Verify extended fingers (tip is far from wrist relative to knuckle base)
    for (const tip of extendedFingers) {
      const tipL = allLandmarks[tip];
      const baseL = allLandmarks[bases[tip]];
      if (!tipL || !baseL) return false;

      const distTip = Math.sqrt(Math.pow(tipL.x - wrist.x, 2) + Math.pow(tipL.y - wrist.y, 2));
      const distBase = Math.sqrt(Math.pow(baseL.x - wrist.x, 2) + Math.pow(baseL.y - wrist.y, 2));

      if (distTip < distBase * 1.3) {
        return false;
      }
    }

    // Verify folded fingers (tip is curled in towards wrist)
    for (const tip of foldedFingers) {
      const tipL = allLandmarks[tip];
      const baseL = allLandmarks[bases[tip]];
      if (!tipL || !baseL) return false;

      const distTip = Math.sqrt(Math.pow(tipL.x - wrist.x, 2) + Math.pow(tipL.y - wrist.y, 2));
      const distBase = Math.sqrt(Math.pow(baseL.x - wrist.x, 2) + Math.pow(baseL.y - wrist.y, 2));

      if (distTip > distBase * 1.15) {
        return false;
      }
    }

    return true;
  }

  /**
   * Performs an algebraic ray-sphere intersection to see if the wand is pointing at an object.
   * Redirected to return the precalculated magnetized and hysteresis-filtered target.
   */
  public findTargetObject(
    _wrist: THREE.Vector3,
    _indexTip: THREE.Vector3,
    _objects: { position: THREE.Vector3; radius: number }[]
  ): number {
    return this.lastTargetIdx;
  }

  public processFrame(
    rawWristX: number, rawWristY: number, _rawWristZ: number,
    rawIndexX: number, rawIndexY: number, _rawIndexZ: number,
    rawThumbX: number, rawThumbY: number, _rawThumbZ: number,
    timestamp: number,
    _camera: THREE.Camera,
    isHoldingObject: boolean = false,
    objects: { position: THREE.Vector3; radius: number }[] = [],
    allLandmarks: any[] | null = null
  ): { 
    position: THREE.Vector3, 
    rotation: THREE.Quaternion, 
    spellCastType: 'none' | 'accio' | 'repulso',
    isPinching: boolean,
    thumbPos: THREE.Vector3,
    indexPos: THREE.Vector3,
    aimDirection: THREE.Vector3,
    targetIdx: number,
    depthRatio: number
  } {
    // Revert back to the highly responsive, ultra-fluid Phase 2 flat mapping
    // targetIndex sits at Z = -1.2 to naturally project straight into the room
    const targetWrist = this.mapTo3D(rawWristX, rawWristY, 0.0);
    const targetIndex = this.mapTo3D(rawIndexX, rawIndexY, -1.2);
    const targetThumb = this.mapTo3D(rawThumbX, rawThumbY, -0.7);

    // Dynamic smoothing factor: snappy 0.45 for aiming, luxurious 0.12 to damp tremors and friction when levitating
    const lerpFactor = isHoldingObject ? 0.12 : 0.45;

    if (this.lastTime === 0) {
      this.smoothedWrist.copy(targetWrist);
      this.smoothedIndex.copy(targetIndex);
      this.smoothedThumb.copy(targetThumb);
    } else {
      // Revert to pure, direct LERP smoothing for instant tactile connection, dynamically scaled
      this.smoothedWrist.lerp(targetWrist, lerpFactor);
      this.smoothedIndex.lerp(targetIndex, lerpFactor);
      this.smoothedThumb.lerp(targetThumb, lerpFactor);
    }

    const dt = this.lastTime === 0 ? 0.016 : (timestamp - this.lastTime) / 1000;

    // --- Aim Vector & Rotation Calculation ---
    // 1. Project hand position to a virtual target plane at object depth (Z = -4.5)
    // This allows the user to aim naturally by moving their hand left/right/up/down in the camera feed
    const hand3D = new THREE.Vector3(this.smoothedIndex.x, this.smoothedIndex.y, -4.5);
    const rawDir = new THREE.Vector3().subVectors(hand3D, this.WAND_PIVOT).normalize();
    
    // 2. Apply One-Euro filter to the direction vector to eliminate high-frequency tremor
    const filteredDir = this.directionFilter.filter(rawDir, dt).normalize();

    // 3. Clamping rotation to forward aiming cone (±55 deg yaw, +30/-40 deg pitch)
    let yaw = Math.atan2(filteredDir.x, -filteredDir.z);
    let pitch = Math.asin(filteredDir.y);

    const maxYaw = 55 * Math.PI / 180;
    const minPitch = -40 * Math.PI / 180;
    const maxPitch = 30 * Math.PI / 180;

    yaw = THREE.MathUtils.clamp(yaw, -maxYaw, maxYaw);
    pitch = THREE.MathUtils.clamp(pitch, minPitch, maxPitch);

    const clampedDir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    ).normalize();

    // 4. Target Magnetism & Hysteresis
    let targetIdx = -1;
    let bestAngle = Infinity;

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const toObj = new THREE.Vector3().subVectors(obj.position, this.WAND_PIVOT);
      const dist = toObj.length();
      if (dist === 0) continue;
      const toObjDir = toObj.clone().normalize();
      
      const cosAngle = clampedDir.dot(toObjDir);
      const angle = Math.acos(THREE.MathUtils.clamp(cosAngle, -1, 1));
      
      // Hysteresis: wider threshold (0.35 rad) if previously targeted, otherwise 0.22 rad
      const isPrev = (i === this.lastTargetIdx);
      const threshold = isPrev ? 0.35 : 0.22;

      if (angle < threshold) {
        if (angle < bestAngle) {
          bestAngle = angle;
          targetIdx = i;
        }
      }
    }

    // Save targeted object for next frame's hysteresis
    this.lastTargetIdx = targetIdx;

    // Apply snap LERP if targeted
    const finalDir = clampedDir.clone();
    if (targetIdx !== -1) {
      const targetObj = objects[targetIdx];
      const toObjDir = new THREE.Vector3().subVectors(targetObj.position, this.WAND_PIVOT).normalize();
      
      // Satisfying, clean snap LERP towards the object center
      finalDir.lerp(toObjDir, 0.65);
      finalDir.normalize();
    }

    // Align wand's local forward (0, 0, 1) with the final magnetized pointing direction
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), finalDir);

    this.lastTime = timestamp;

    const isPinching = this.checkPinch(allLandmarks, timestamp);
    const isFist = this.checkFist(allLandmarks);
    const isTwoFingerPoint = this.checkTwoFingerPoint(allLandmarks);

    let handScale = 0.15;
    if (allLandmarks && allLandmarks.length > 17) {
      const wristL = allLandmarks[0];
      const indexBaseL = allLandmarks[5];
      const pinkyBaseL = allLandmarks[17];
      if (wristL && indexBaseL && pinkyBaseL) {
        const distIndex = Math.sqrt(Math.pow(wristL.x - indexBaseL.x, 2) + Math.pow(wristL.y - indexBaseL.y, 2));
        const distPinky = Math.sqrt(Math.pow(wristL.x - pinkyBaseL.x, 2) + Math.pow(wristL.y - pinkyBaseL.y, 2));
        handScale = (distIndex + distPinky) / 2.0;
      }
    }

    if (this.baselineScale === -1) {
      this.baselineScale = handScale;
    } else if (!isPinching && !isFist && !isTwoFingerPoint && this.depthSpellState === 'none') {
      this.baselineScale += (handScale - this.baselineScale) * 0.25 * dt;
    }

    const ratio = handScale / this.baselineScale;

    if (isPinching) {
      this.depthSpellState = 'none';
    } else if (isFist) {
      this.depthSpellState = 'accio';
    } else if (isTwoFingerPoint) {
      this.depthSpellState = 'repulso';
    } else {
      this.depthSpellState = 'none';
    }

    return {
      position: this.WAND_PIVOT.clone(),
      rotation,
      spellCastType: this.depthSpellState,
      isPinching,
      thumbPos: this.smoothedThumb,
      indexPos: this.smoothedIndex,
      aimDirection: finalDir,
      targetIdx,
      depthRatio: ratio
    };
  }
}
