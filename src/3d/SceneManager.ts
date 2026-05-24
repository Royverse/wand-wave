import * as THREE from 'three';

export class SceneManager {
  public scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private wand!: THREE.Mesh;
  private aimLaser!: THREE.Mesh;
  
  // Selection and spells
  private targetRing!: THREE.Mesh;
  private particles: { mesh: THREE.Mesh; createdAt: number; velocity: THREE.Vector3; color: THREE.Color }[] = [];
  
  // Practice course targets
  private goals: { mesh: THREE.Mesh; originalY: number; radius: number; color: number; cleared: boolean }[] = [];
  
  // Ambient elements
  private dustPoints!: THREE.Points;

  constructor() {
    this.scene = new THREE.Scene();
    // Background and Fog removed to enable transparent overlay on the webcam video feed

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Camera positioned slightly higher, looking down on the room
    this.camera.position.set(0, 3, 5);
    this.camera.lookAt(0, 2, -2);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);
    
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.zIndex = '1';

    this.setupLights();
    this.setupRoom();
    this.setupWand();
    this.setupTargetRing();
    this.setupAtmosphere();
    this.setupGoals();

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private setupLights() {
    const ambientLight = new THREE.AmbientLight(0x12245c, 1.2); // Mid-toned Midnight Blue glow
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 12, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 25;
    
    // Smooth shadows bounding box
    const d = 8;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    
    this.scene.add(dirLight);

    // Glowing spell cast point light using Electric Mint (#97FEED)
    const magicPointLight = new THREE.PointLight(0x97FEED, 1.5, 8);
    magicPointLight.position.set(0, 6, -3);
    this.scene.add(magicPointLight);
  }

  private setupRoom() {
    // Transparent Floor Plane that catches shadows for a premium integrated AR look
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.5 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Beautiful glowing spatial grid on floor in Teal Cyan (#35A29F) and Midnight Blue (#071952)
    const gridHelper = new THREE.GridHelper(30, 30, 0x35A29F, 0x071952);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  private setupWand() {
    // Elegant, magic-infused wand geometry
    const geometry = new THREE.CylinderGeometry(0.04, 0.08, 2, 16);
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, 1); // Move origin to base

    const material = new THREE.MeshStandardMaterial({ 
      color: 0x1a110a,
      emissive: 0x150b05,
      roughness: 0.9,
      metalness: 0.1
    });
    this.wand = new THREE.Mesh(geometry, material);
    this.wand.castShadow = true;
    this.scene.add(this.wand);

    // Glowing crystal tip in Electric Mint (#97FEED)
    const tipGeo = new THREE.ConeGeometry(0.08, 0.25, 8);
    tipGeo.rotateX(Math.PI / 2);
    tipGeo.translate(0, 0, 2.1); // Sit exactly at the tip
    const tipMat = new THREE.MeshBasicMaterial({ color: 0x97FEED });
    const tipCrystal = new THREE.Mesh(tipGeo, tipMat);
    this.wand.add(tipCrystal);

    // Dotted/solid holographic magical aiming laser ray (child of wand)
    const laserGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 8);
    laserGeo.rotateX(Math.PI / 2);
    laserGeo.translate(0, 0, 0.5); // origin at base of laser so scaling Z extends it forward
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0x97FEED,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending
    });
    this.aimLaser = new THREE.Mesh(laserGeo, laserMat);
    this.aimLaser.position.set(0, 0, 2.1); // sit exactly at the crystal tip
    this.wand.add(this.aimLaser);
  }

  public updateAimLaser(targetDistance: number | null) {
    if (targetDistance !== null) {
      this.aimLaser.scale.z = targetDistance;
      // Thick, energetic glowing ray when locked onto a target
      this.aimLaser.scale.x = 2.2;
      this.aimLaser.scale.y = 2.2;
      (this.aimLaser.material as THREE.Material).opacity = 0.65 + Math.sin(Date.now() * 0.02) * 0.25; // energetic pulsation
      (this.aimLaser.material as THREE.MeshBasicMaterial).color.setHex(0x97FEED); // vibrant Electric Mint
    } else {
      // Thin, faint searchlight ray when aiming at nothing
      this.aimLaser.scale.z = 12.0;
      this.aimLaser.scale.x = 0.8;
      this.aimLaser.scale.y = 0.8;
      (this.aimLaser.material as THREE.Material).opacity = 0.15 + Math.sin(Date.now() * 0.005) * 0.05; // slow breathing opacity
      (this.aimLaser.material as THREE.MeshBasicMaterial).color.setHex(0x35A29F); // soft Teal Cyan
    }
  }

  private setupTargetRing() {
    // Glowing ring positioned underneath targeted objects
    const ringGeo = new THREE.RingGeometry(0.7, 0.8, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x97FEED,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0
    });
    this.targetRing = new THREE.Mesh(ringGeo, ringMat);
    this.targetRing.position.y = 0.02; // sit just above floor grid
    this.scene.add(this.targetRing);
  }

  private setupAtmosphere() {
    // Ambient glowing dust particles floating slowly
    const count = 150;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 15;
      pos[i + 1] = Math.random() * 8;
      pos[i + 2] = (Math.random() - 0.5) * 15;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x97FEED,
      size: 0.06,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending
    });
    this.dustPoints = new THREE.Points(geo, mat);
    this.scene.add(this.dustPoints);
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public getWandTipPosition(): THREE.Vector3 {
    const tipLocal = new THREE.Vector3(0, 0, 2.1);
    return tipLocal.applyMatrix4(this.wand.matrixWorld);
  }

  public updateWand(position: THREE.Vector3, quaternion: THREE.Quaternion) {
    this.wand.position.copy(position);
    
    // Inject subtle procedural organic idle drift (breathing) to wand rotation
    const time = Date.now() * 0.0025; // 0.4 Hz breathing frequency
    const driftAngleX = Math.sin(time) * 0.012; // extremely subtle pitch drift
    const driftAngleY = Math.cos(time * 0.7) * 0.015; // extremely subtle yaw drift
    
    const driftQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(driftAngleX, driftAngleY, 0));
    const finalQuat = quaternion.clone().multiply(driftQuat);
    this.wand.quaternion.copy(finalQuat);
  }

  public updateTargetRing(targetPos: THREE.Vector3 | null) {
    if (targetPos) {
      this.targetRing.position.set(targetPos.x, 0.02, targetPos.z);
      (this.targetRing.material as THREE.Material).opacity = 0.8 + Math.sin(Date.now() * 0.01) * 0.2; // pulse
    } else {
      (this.targetRing.material as THREE.Material).opacity = 0.0;
    }
  }

  public triggerSpell(colorHex: number = 0x00ffff, isLevitate: boolean = false) {
    const pCount = isLevitate ? 3 : 15; // Leviosa has continuous stream, Accio has sudden burst
    const particleGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const color = new THREE.Color(colorHex);

    const tipWorld = this.getWandTipPosition();

    for (let i = 0; i < pCount; i++) {
      const particleMat = new THREE.MeshBasicMaterial({ 
        color: color,
        transparent: true,
        opacity: 1
      });
      const particle = new THREE.Mesh(particleGeo, particleMat);
      particle.position.copy(tipWorld);
      this.scene.add(particle);

      // Random speed burst
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.15
      );

      this.particles.push({ mesh: particle, createdAt: Date.now(), velocity, color });
    }
  }

  public triggerObjectAura(objPos: THREE.Vector3, colorHex: number) {
    // Generate beautiful floating magical sparks around an active spell-bound object
    const particleGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const color = new THREE.Color(colorHex);
    const particleMat = new THREE.MeshBasicMaterial({ 
      color: color,
      transparent: true,
      opacity: 0.8
    });
    const particle = new THREE.Mesh(particleGeo, particleMat);
    
    // Spawn in a shell around the object
    const radius = 0.6;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    particle.position.set(
      objPos.x + radius * Math.sin(phi) * Math.cos(theta),
      objPos.y + radius * Math.sin(phi) * Math.sin(theta),
      objPos.z + radius * Math.cos(phi)
    );

    this.scene.add(particle);
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.02,
      Math.random() * 0.05, // Float upwards
      (Math.random() - 0.5) * 0.02
    );

    this.particles.push({ mesh: particle, createdAt: Date.now(), velocity, color });
  }

  private setupGoals() {
    const goalData = [
      { x: -3.2, y: 1.8, z: -4.0, radius: 0.8, color: 0x97FEED }, // Hoop 1: Electric Mint (Low, Left)
      { x: 0.0, y: 4.8, z: -4.5, radius: 0.8, color: 0x35A29F },  // Hoop 2: Teal Cyan (High, Mid)
      { x: 3.2, y: 3.2, z: -4.0, radius: 0.8, color: 0xe0fffa }   // Hoop 3: Bright Aqua-Mint (Medium, Right)
    ];

    const torusGeo = new THREE.TorusGeometry(0.8, 0.07, 16, 100);

    goalData.forEach((data) => {
      const mat = new THREE.MeshStandardMaterial({
        color: data.color,
        emissive: data.color,
        emissiveIntensity: 1.8,
        roughness: 0.2,
        metalness: 0.9,
        transparent: true,
        opacity: 0.85
      });

      const mesh = new THREE.Mesh(torusGeo, mat);
      mesh.position.set(data.x, data.y, data.z);
      mesh.castShadow = true;
      this.scene.add(mesh);

      this.goals.push({
        mesh,
        originalY: data.y,
        radius: data.radius,
        color: data.color,
        cleared: false
      });
    });
  }

  public checkGoalCollisions(objects: { position: THREE.Vector3; radius: number }[]): number[] {
    const newlyCleared: number[] = [];

    for (let i = 0; i < this.goals.length; i++) {
      const goal = this.goals[i];
      if (goal.cleared) continue;

      for (const obj of objects) {
        const dist = obj.position.distanceTo(goal.mesh.position);
        if (dist < goal.radius + obj.radius * 0.6) {
          goal.cleared = true;
          newlyCleared.push(i);

          // Ignite the hoop visual intensity
          (goal.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 8.0;
          (goal.mesh.material as THREE.MeshStandardMaterial).opacity = 1.0;

          // Trigger grand goal explosion sparkles
          this.triggerGoalExplosion(goal.mesh.position, goal.color);
          break;
        }
      }
    }

    return newlyCleared;
  }

  private triggerGoalExplosion(pos: THREE.Vector3, colorHex: number) {
    const pCount = 60;
    const particleGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const color = new THREE.Color(colorHex);

    for (let i = 0; i < pCount; i++) {
      const particleMat = new THREE.MeshBasicMaterial({ 
        color: color,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending
      });
      const particle = new THREE.Mesh(particleGeo, particleMat);
      particle.position.copy(pos);
      this.scene.add(particle);

      // Radial speed burst
      const speed = 0.05 + Math.random() * 0.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      
      const velocity = new THREE.Vector3(
        speed * Math.sin(phi) * Math.cos(theta),
        speed * Math.sin(phi) * Math.sin(theta),
        speed * Math.cos(phi)
      );

      this.particles.push({ mesh: particle, createdAt: Date.now(), velocity, color });
    }
  }

  public resetGoals() {
    this.goals.forEach(goal => {
      goal.cleared = false;
      (goal.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.8;
      (goal.mesh.material as THREE.MeshStandardMaterial).opacity = 0.85;
    });
  }

  public render() {
    const now = Date.now();

    // 1. Slow drift atmosphere
    if (this.dustPoints) {
      const positions = this.dustPoints.geometry.attributes.position.array as Float32Array;
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] -= 0.005; // slowly sink
        if (positions[i] < 0) positions[i] = 8; // reset to ceiling
      }
      this.dustPoints.geometry.attributes.position.needsUpdate = true;
    }

    // 2. Animate hoops (breathing float + spin)
    const timeSec = now * 0.0015;
    this.goals.forEach((goal, idx) => {
      if (!goal.cleared) {
        // Slow continuous rotations
        goal.mesh.rotation.y = timeSec * 0.4 + idx;
        goal.mesh.rotation.x = Math.sin(timeSec * 0.6 + idx) * 0.15;
        // Soft floating drift
        goal.mesh.position.y = goal.originalY + Math.sin(timeSec * 1.2 + idx) * 0.12;
      } else {
        // Cleared goals spin extremely fast in celebration!
        goal.mesh.rotation.y += 0.08;
        const mat = goal.mesh.material as THREE.MeshStandardMaterial;
        if (mat.emissiveIntensity > 2.2) {
          mat.emissiveIntensity -= 0.08; // fade glow intensity slowly
        }
      }
    });

    // 3. Update and clean up spell particles
    this.particles = this.particles.filter(p => {
      const age = now - p.createdAt;
      const lifespan = 600; // shorter lifespan for snappy trails
      if (age > lifespan) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        return false;
      }
      
      p.mesh.position.add(p.velocity);
      (p.mesh.material as THREE.Material).opacity = 1.0 - (age / lifespan);
      // scale down slightly over time
      const scale = 1.0 - (age / lifespan) * 0.5;
      p.mesh.scale.set(scale, scale, scale);
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  }
}
