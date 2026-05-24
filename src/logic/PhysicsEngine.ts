import * as THREE from 'three';

export interface PhysicalObject {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  mass: number;
  isStatic: boolean;
  mesh: THREE.Mesh;
  type: 'volleyball' | 'bat';
}

export class PhysicsEngine {
  private objects: PhysicalObject[] = [];
  private gravity = new THREE.Vector3(0, -9.8, 0);
  private dragCoefficient = 0.98; // Air resistance dampening
  
  // Room boundary dimensions
  private minX = -6;
  private maxX = 6;
  private minY = 0.1; // Floor level
  private maxY = 8;
  private minZ = -8;
  private maxZ = 2; // Closer to camera

  public addObject(obj: PhysicalObject) {
    this.objects.push(obj);
  }

  public getObjects(): PhysicalObject[] {
    return this.objects;
  }

  public update(dt: number) {
    if (dt <= 0) return;
    // Cap dt to prevent massive physics jumps on frame stutter
    const clampedDt = Math.min(dt, 0.03);

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj.isStatic) continue;

      // 1. Apply Gravity
      obj.velocity.addScaledVector(this.gravity, clampedDt);

      // 2. Apply Air Drag
      obj.velocity.multiplyScalar(Math.pow(this.dragCoefficient, clampedDt * 60));

      // 3. Update Position
      obj.position.addScaledVector(obj.velocity, clampedDt);

      // 4. Handle Room Boundary Collisions (Bouncing off walls)
      const elasticity = 0.7; // Bounce dampening

      // Floor
      if (obj.position.y - obj.radius < this.minY) {
        obj.position.y = this.minY + obj.radius;
        obj.velocity.y = -obj.velocity.y * elasticity;
        // Friction on floor
        obj.velocity.x *= 0.9;
        obj.velocity.z *= 0.9;
      }
      // Ceiling
      if (obj.position.y + obj.radius > this.maxY) {
        obj.position.y = this.maxY - obj.radius;
        obj.velocity.y = -obj.velocity.y * elasticity;
      }
      // Left/Right walls (X)
      if (obj.position.x - obj.radius < this.minX) {
        obj.position.x = this.minX + obj.radius;
        obj.velocity.x = -obj.velocity.x * elasticity;
      }
      if (obj.position.x + obj.radius > this.maxX) {
        obj.position.x = this.maxX - obj.radius;
        obj.velocity.x = -obj.velocity.x * elasticity;
      }
      // Back/Front walls (Z)
      if (obj.position.z - obj.radius < this.minZ) {
        obj.position.z = this.minZ + obj.radius;
        obj.velocity.z = -obj.velocity.z * elasticity;
      }
      if (obj.position.z + obj.radius > this.maxZ) {
        obj.position.z = this.maxZ - obj.radius;
        obj.velocity.z = -obj.velocity.z * elasticity;
      }

      // Sync 3D Mesh
      obj.mesh.position.copy(obj.position);
    }

    // 5. Handle Sphere-Sphere Elastic Collisions between objects
    this.handleObjectCollisions();
  }

  private handleObjectCollisions() {
    for (let i = 0; i < this.objects.length; i++) {
      for (let j = i + 1; j < this.objects.length; j++) {
        const objA = this.objects[i];
        const objB = this.objects[j];

        const dist = objA.position.distanceTo(objB.position);
        const minDist = objA.radius + objB.radius;

        if (dist < minDist) {
          // Resolve overlap
          const overlap = minDist - dist;
          const normal = new THREE.Vector3().subVectors(objB.position, objA.position).normalize();

          // Push objects apart equally (or based on mass if dynamic)
          if (!objA.isStatic && !objB.isStatic) {
            objA.position.addScaledVector(normal, -overlap * 0.5);
            objB.position.addScaledVector(normal, overlap * 0.5);

            // Elastic collision physics (velocities exchange)
            const relativeVelocity = new THREE.Vector3().subVectors(objB.velocity, objA.velocity);
            const velAlongNormal = relativeVelocity.dot(normal);

            if (velAlongNormal < 0) {
              const restitution = 0.8;
              const impulseScalar = -(1 + restitution) * velAlongNormal / (1/objA.mass + 1/objB.mass);
              
              objA.velocity.addScaledVector(normal, -impulseScalar / objA.mass);
              objB.velocity.addScaledVector(normal, impulseScalar / objB.mass);
            }
          }
        }
      }
    }
  }

  // Spell interaction forces
  public applyPullForce(obj: PhysicalObject, target: THREE.Vector3, forceMagnitude: number, dt: number) {
    const clampedDt = Math.min(dt, 0.03);
    const direction = new THREE.Vector3().subVectors(target, obj.position);
    const distance = direction.length();
    direction.normalize();

    // Pull force is stronger the further away it is, capped
    const force = Math.min(distance * forceMagnitude, 25);
    obj.velocity.addScaledVector(direction, force * 3.0 * clampedDt);
  }

  public applyHoverForce(obj: PhysicalObject, target: THREE.Vector3, dt: number) {
    const clampedDt = Math.min(dt, 0.03);

    // 1. Counter gravity exactly
    const gravityCounterForce = new THREE.Vector3(0, 9.8, 0);
    obj.velocity.addScaledVector(gravityCounterForce, clampedDt);

    // 2. Spring attraction force
    const attraction = new THREE.Vector3().subVectors(target, obj.position);
    const dist = attraction.length();
    if (dist > 0.01) {
      const dir = attraction.clone().normalize();
      // Strong spring pull
      const springMagnitude = dist * 15.0; 
      obj.velocity.addScaledVector(dir, springMagnitude * clampedDt);
    }

    // 3. High viscous damping specifically when levitating to kill pendulum oscillations
    // Retain only a fraction of velocity to simulate movement through a magical viscous fluid.
    // At 60fps (dt=0.016), this retains ~91% of velocity per frame, which is extremely stable.
    const viscousDamp = Math.pow(0.005, clampedDt);
    obj.velocity.multiplyScalar(viscousDamp);
  }

  public applyPushForce(obj: PhysicalObject, direction: THREE.Vector3, forceMagnitude: number, dt: number) {
    const clampedDt = Math.min(dt, 0.03);
    const dir = direction.clone().normalize();
    
    // Massive impulse force
    obj.velocity.addScaledVector(dir, forceMagnitude * 3.0 * clampedDt);
  }
}
