import * as THREE from 'three';
import { HandTracker } from './cv/HandTracker';
import { SceneManager } from './3d/SceneManager';
import { GestureMath } from './logic/GestureMath';
import { PhysicsEngine, type PhysicalObject } from './logic/PhysicsEngine';

async function init() {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.innerText = 'Initializing WebAR environment and AI models...';

  try {
    const handTracker = new HandTracker();
    await handTracker.initialize();

    const sceneManager = new SceneManager();
    const gestureMath = new GestureMath();
    const physicsEngine = new PhysicsEngine();

    // 1. Create interactive room objects & add to both Three.js and Physics Engine
    createRoomObjects(sceneManager.scene, physicsEngine);

    if (statusEl) {
      statusEl.innerHTML = `
        <strong>Ready!</strong> Point at an object to aim.<br/>
        ☝️ <em>Leviosa:</em> Point index finger to float.<br/>
        ✊ <em>Accio:</em> Clench fist to pull towards you.<br/>
        ✌️ <em>Depulso:</em> Peace sign to push away!
      `;
    }

    const debugCanvas = document.getElementById('debug-canvas') as HTMLCanvasElement | null;
    const debugCtx = debugCanvas?.getContext('2d');

    const cardLeviosa = document.getElementById('card-leviosa');
    const cardDepulso = document.getElementById('card-depulso');
    const cardAccio = document.getElementById('card-accio');

    const HAND_CONNECTIONS = [
      [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8],       // Index
      [9, 10], [10, 11], [11, 12],          // Middle
      [13, 14], [14, 15], [15, 16],         // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [5, 9], [9, 13], [13, 17]             // Palm base
    ];

    let lastTime = 0;
    let activeSpellObject: PhysicalObject | null = null;
    let currentTargetIdx = -1;
    let clearedGoalsCount = 0;

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        clearedGoalsCount = 0;
        const scoreStatusEl = document.getElementById('score-status');
        if (scoreStatusEl) {
          scoreStatusEl.innerText = `Targets Cleared: 0 / 3`;
        }

        const victoryOverlay = document.getElementById('victory-overlay');
        if (victoryOverlay) {
          victoryOverlay.style.display = 'none';
        }

        sceneManager.resetGoals();

        const physObjects = physicsEngine.getObjects();
        physObjects.forEach(obj => {
          obj.velocity.set(0, 0, 0);
          if (obj.type === 'volleyball') {
            obj.position.set(-1.8, 3.5, -4);
          } else if (obj.type === 'bat') {
            obj.position.set(1.8, 4.0, -4);
            obj.mesh.rotation.set(0, 0, Math.PI / 8);
          }
          obj.mesh.position.copy(obj.position);
        });
      });
    }

    let lastValidHandState: {
      position: THREE.Vector3,
      rotation: THREE.Quaternion,
      spellCastType: 'none' | 'accio' | 'repulso',
      isPinching: boolean,
      timestamp: number,
      depthRatio: number
    } | null = null;
    const TRACKING_GRACE_PERIOD = 1500; // ms
    let currentHoverDist = 3.0;

    const loop = (timestamp: number) => {
      // Calculate delta time in seconds
      if (lastTime === 0) lastTime = timestamp;
      const dt = (timestamp - lastTime) / 1000;
      lastTime = timestamp;

      const { wrist, indexTip, thumbTip, allLandmarks } = handTracker.detect(timestamp);
      
      // Draw Video Feed to bottom-right PiP Canvas
      if (debugCanvas && debugCtx) {
        const video = handTracker.getVideoElement();
        if (video.videoWidth > 0) {
          if (debugCanvas.width !== video.videoWidth) {
            debugCanvas.width = video.videoWidth;
            debugCanvas.height = video.videoHeight;
          }
          debugCtx.drawImage(video, 0, 0, debugCanvas.width, debugCanvas.height);
        }
      }

      let currentHandState = null;
      const isHoldingObject = activeSpellObject !== null;
      const physObjects = physicsEngine.getObjects();

      if (wrist && indexTip && thumbTip) {
        currentHandState = gestureMath.processFrame(
          wrist.x, wrist.y, wrist.z || 0,
          indexTip.x, indexTip.y, indexTip.z || 0,
          thumbTip.x, thumbTip.y, thumbTip.z || 0,
          timestamp,
          sceneManager.getCamera(),
          isHoldingObject,
          physObjects,
          allLandmarks
        );

        lastValidHandState = {
          position: currentHandState.position.clone(),
          rotation: currentHandState.rotation.clone(),
          spellCastType: currentHandState.spellCastType,
          isPinching: currentHandState.isPinching,
          timestamp: timestamp,
          depthRatio: currentHandState.depthRatio
        };
      } else if (lastValidHandState && (timestamp - lastValidHandState.timestamp < TRACKING_GRACE_PERIOD)) {
        // Use grace period data if tracking flickers completely
        currentHandState = {
          position: lastValidHandState.position,
          rotation: lastValidHandState.rotation,
          spellCastType: 'none' as const, // Don't re-trigger flicks during grace period
          isPinching: lastValidHandState.isPinching,
          aimDirection: new THREE.Vector3(0, 0, 1).applyQuaternion(lastValidHandState.rotation),
          targetIdx: -1,
          depthRatio: lastValidHandState.depthRatio
        };
      }

      if (currentHandState) {
        // Update 3D Wand transformation in Three.js
        sceneManager.updateWand(currentHandState.position, currentHandState.rotation);
        const wandTip = sceneManager.getWandTipPosition();

        // Perform raycast targeting every frame if no object is currently levitating
        let targetDistance: number | null = null;

        if (!activeSpellObject) {
          currentTargetIdx = currentHandState.targetIdx;
          if (currentTargetIdx !== -1) {
            const targeted = physObjects[currentTargetIdx];
            sceneManager.updateTargetRing(targeted.position);
            
            // Terminate laser exactly at the object boundary
            const dist = wandTip.distanceTo(targeted.position);
            targetDistance = Math.max(0.1, dist - targeted.radius);
          } else {
            sceneManager.updateTargetRing(null);
          }
        } else {
          // If already holding/levitating, snap selection ring and aiming laser to that object
          sceneManager.updateTargetRing(activeSpellObject.position);
          const dist = wandTip.distanceTo(activeSpellObject.position);
          targetDistance = Math.max(0.1, dist - activeSpellObject.radius);
        }

        // Update the dynamic glowing aiming laser ray
        sceneManager.updateAimLaser(targetDistance);

        // --- SPELLCASTING LOGIC & HUD HIGHLIGHTS ---
        
        // Reset card backgrounds
        if (cardLeviosa) {
          cardLeviosa.style.background = '';
          cardLeviosa.style.borderColor = '';
          cardLeviosa.style.boxShadow = '';
        }
        if (cardDepulso) {
          cardDepulso.style.background = '';
          cardDepulso.style.borderColor = '';
          cardDepulso.style.boxShadow = '';
        }
        if (cardAccio) {
          cardAccio.style.background = '';
          cardAccio.style.borderColor = '';
          cardAccio.style.boxShadow = '';
        }
        
        // 1. Wingardium Leviosa (Pinch to Levitate)
        if (currentHandState.isPinching && currentTargetIdx !== -1) {
          const wasJustPickedUp = !activeSpellObject;
          activeSpellObject = physObjects[currentTargetIdx];
          
          if (wasJustPickedUp) {
            // Calculate and lock the exact distance from the wand pivot to the object when grabbed
            currentHoverDist = activeSpellObject.position.distanceTo(currentHandState.position);
          }
          
          // Dynamic Hover Target: Projects the aim direction out to the locked distance
          const hoverTarget = new THREE.Vector3()
            .copy(currentHandState.position)
            .add(currentHandState.aimDirection.clone().multiplyScalar(currentHoverDist));
          
          // Amplified vertical range: Scale up vertical hand movements by 2.2x relative to neutral height
          const verticalRestHeight = 2.0;
          const deltaY = hoverTarget.y - verticalRestHeight;
          hoverTarget.y = verticalRestHeight + deltaY * 2.2;
          
          physicsEngine.applyHoverForce(activeSpellObject, hoverTarget, dt);
          
          // Emit magic particle beams and aura
          sceneManager.triggerSpell(0x97FEED, true); // electric mint streams
          sceneManager.triggerObjectAura(activeSpellObject.position, 0x97FEED);

          if (statusEl) {
            statusEl.innerHTML = `🧙‍♂️ <strong>Levitating ${activeSpellObject.type}!</strong><br/>Move your hand freely left/right/up/down to float the object.`;
          }
          if (cardLeviosa) {
            cardLeviosa.style.background = 'rgba(151, 254, 237, 0.15)';
            cardLeviosa.style.borderColor = 'rgba(151, 254, 237, 0.4)';
            cardLeviosa.style.boxShadow = '0 0 15px rgba(151, 254, 237, 0.2)';
          }
        } else {
          // Release levitation
          activeSpellObject = null;
        }

        // 2. Accio & Repulso (Sustained depth-perception triggers)
        if (!currentHandState.isPinching && currentTargetIdx !== -1) {
          const spellObj = physObjects[currentTargetIdx];

          if (currentHandState.spellCastType === 'accio') {
            // Analog scaling: how far back hand is pulled (depthRatio < 1)
            const scaleAmount = Math.max(0.1, 1.0 - currentHandState.depthRatio) * 3.5;
            const forcePercent = Math.min(Math.round(scaleAmount * 100), 100);

            // Perform Accio (Pull towards Wand)
            physicsEngine.applyPullForce(spellObj, wandTip, 10 * scaleAmount, dt);
            
            // Emit fiery glowing mint/aqua spell burst!
            sceneManager.triggerSpell(0xe0fffa, false); // bright mint burst
            sceneManager.triggerObjectAura(spellObj.position, 0xe0fffa);

            if (statusEl) {
              statusEl.innerHTML = `⚡ <strong>Accio (Sustained Pull) Active</strong><br/>Continuous pull thruster at <span style="color: #97FEED; font-weight: 700;">${forcePercent}% power</span>.`;
            }
            if (cardAccio) {
              cardAccio.style.background = 'rgba(224, 255, 250, 0.15)';
              cardAccio.style.borderColor = 'rgba(224, 255, 250, 0.4)';
              cardAccio.style.boxShadow = '0 0 15px rgba(224, 255, 250, 0.2)';
            }
          } else if (currentHandState.spellCastType === 'repulso') {
            // Analog scaling: how far forward hand is pushed (depthRatio > 1)
            const scaleAmount = Math.max(0.1, currentHandState.depthRatio - 1.0) * 3.5;
            const forcePercent = Math.min(Math.round(scaleAmount * 100), 100);

            // Perform Repulso (Push away along the aim direction)
            physicsEngine.applyPushForce(spellObj, currentHandState.aimDirection, 20 * scaleAmount, dt);
            
            // Emit teal cyan spell burst!
            sceneManager.triggerSpell(0x35A29F, false); // teal cyan burst
            sceneManager.triggerObjectAura(spellObj.position, 0x35A29F);

            if (statusEl) {
              statusEl.innerHTML = `💥 <strong>Depulso (Sustained Push) Active</strong><br/>Continuous push thruster at <span style="color: #35A29F; font-weight: 700;">${forcePercent}% power</span>.`;
            }
            if (cardDepulso) {
              cardDepulso.style.background = 'rgba(53, 162, 159, 0.15)';
              cardDepulso.style.borderColor = 'rgba(53, 162, 159, 0.4)';
              cardDepulso.style.boxShadow = '0 0 15px rgba(53, 162, 159, 0.2)';
            }
          }
        }

        // Default resting guide if no spell is being cast
        if (!currentHandState.isPinching && currentHandState.spellCastType === 'none') {
          if (statusEl) {
            if (currentTargetIdx !== -1) {
              const targeted = physObjects[currentTargetIdx];
              statusEl.innerHTML = `🎯 <strong>Target Locked: ${targeted.type}</strong><br/>Pinch fingers to hover. Push forward for Depulso. Pull backward for Accio.`;
            } else {
              statusEl.innerHTML = `🔮 <strong>Wand Aiming...</strong><br/>Hover laser onto the Volleyball or Bat to bind your magical aura.`;
            }
          }
        }

        // Draw CV Hand Overlay to Debug Canvas
        if (allLandmarks && debugCanvas && debugCtx) {
          // Draw connections (cyan)
          debugCtx.strokeStyle = '#00ffcc';
          debugCtx.lineWidth = 3;
          for (const [start, end] of HAND_CONNECTIONS) {
            const startPt = allLandmarks[start];
            const endPt = allLandmarks[end];
            if (startPt && endPt) {
              debugCtx.beginPath();
              debugCtx.moveTo(startPt.x * debugCanvas.width, startPt.y * debugCanvas.height);
              debugCtx.lineTo(endPt.x * debugCanvas.width, endPt.y * debugCanvas.height);
              debugCtx.stroke();
            }
          }

          // Draw joints (Index Tip = Red, Thumb Tip = Yellow, Wrist = Orange)
          allLandmarks.forEach((landmark, index) => {
            if (index === 8) {
              debugCtx.fillStyle = currentHandState?.isPinching ? '#00ffcc' : '#ff0055'; // Pink/Cyan when pinching
            } else if (index === 4) {
              debugCtx.fillStyle = currentHandState?.isPinching ? '#00ffcc' : '#ffcc00';
            } else if (index === 0) {
              debugCtx.fillStyle = '#ff8800'; // Orange
            } else {
              debugCtx.fillStyle = '#00ffff'; // Light cyan for others
            }

            debugCtx.beginPath();
            debugCtx.arc(
              landmark.x * debugCanvas.width,
              landmark.y * debugCanvas.height,
              index === 8 || index === 4 || index === 0 ? 6 : 4,
              0,
              2 * Math.PI
            );
            debugCtx.fill();
          });
        }
      }

      // Step physics simulation
      physicsEngine.update(dt);

      // Check practice range hoop clearances
      const newlyCleared = sceneManager.checkGoalCollisions(physicsEngine.getObjects());
      if (newlyCleared.length > 0) {
        clearedGoalsCount += newlyCleared.length;

        const scoreStatusEl = document.getElementById('score-status');
        if (scoreStatusEl) {
          scoreStatusEl.innerText = `Targets Cleared: ${clearedGoalsCount} / 3`;
        }

        // Celebrate Master Wizard victory
        if (clearedGoalsCount >= 3) {
          const victoryOverlay = document.getElementById('victory-overlay');
          if (victoryOverlay) {
            victoryOverlay.style.display = 'flex';
          }
        }
      }

      // Render 3D frame
      sceneManager.render();
      
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);

  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color: #ff3366;">Error: ${err}</span>`;
    console.error(err);
  }
}

function createRoomObjects(scene: THREE.Scene, physics: PhysicsEngine) {
  // 1. Create a beautiful striped Volleyball (Sphere)
  const ballGeo = new THREE.SphereGeometry(0.5, 32, 32);
  
  // Custom canvas-drawn striped texture for a premium volleyball design matching the custom palette
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0B666A'; // Deep Teal Base
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#35A29F'; // Teal Cyan Stripe
  ctx.fillRect(0, 42, 128, 42);
  ctx.fillStyle = '#97FEED'; // Electric Mint Accents
  ctx.fillRect(0, 0, 128, 10);
  ctx.fillRect(0, 84, 128, 10);

  const texture = new THREE.CanvasTexture(canvas);
  const ballMat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.3,
    metalness: 0.1
  });

  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  ballMesh.position.set(-1.8, 3.5, -4);
  scene.add(ballMesh);

  physics.addObject({
    id: 'volleyball',
    position: ballMesh.position,
    velocity: new THREE.Vector3(0, 0, 0),
    radius: 0.5,
    mass: 1.0,
    isStatic: false,
    mesh: ballMesh,
    type: 'volleyball'
  });

  // 2. Create a glowing/premium Cyber Baseball Bat (Cylinder)
  const batGeo = new THREE.CylinderGeometry(0.08, 0.16, 1.8, 16);
  const batMat = new THREE.MeshStandardMaterial({
    color: 0x35A29F, // Teal Cyan
    emissive: 0x0B666A, // Deep Teal glow
    emissiveIntensity: 0.8,
    roughness: 0.4,
    metalness: 0.7
  });
  
  const batMesh = new THREE.Mesh(batGeo, batMat);
  batMesh.castShadow = true;
  batMesh.receiveShadow = true;
  batMesh.position.set(1.8, 4.0, -4);
  batMesh.rotation.z = Math.PI / 8; // start with slight tilt
  scene.add(batMesh);

  physics.addObject({
    id: 'cyber_bat',
    position: batMesh.position,
    velocity: new THREE.Vector3(0, 0, 0),
    radius: 0.45, // bounding cylinder treated as slightly flattened sphere bounds
    mass: 2.2,
    isStatic: false,
    mesh: batMesh,
    type: 'bat'
  });
}

init();
