import { HandLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export class HandTracker {
  private videoElement: HTMLVideoElement;
  private handLandmarker: HandLandmarker | null = null;
  private isCameraReady = false;

  constructor() {
    this.videoElement = document.createElement("video");
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
  }

  public async initialize(): Promise<void> {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.35,
        minHandPresenceConfidence: 0.35,
        minTrackingConfidence: 0.35
      });

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      this.videoElement.srcObject = stream;
      
      return new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          this.isCameraReady = true;
          resolve();
        };
      });
    } catch (error) {
      console.error("Failed to initialize HandTracker:", error);
      throw error;
    }
  }

  public detect(timestamp: number): { 
    wrist: NormalizedLandmark | null, 
    indexTip: NormalizedLandmark | null,
    thumbTip: NormalizedLandmark | null,
    allLandmarks: NormalizedLandmark[] | null
  } {
    if (!this.handLandmarker || !this.isCameraReady) {
      return { wrist: null, indexTip: null, thumbTip: null, allLandmarks: null };
    }

    const results = this.handLandmarker.detectForVideo(this.videoElement, timestamp);
    
    if (results.landmarks && results.landmarks.length > 0) {
      const landmarks = results.landmarks[0];
      return {
        wrist: landmarks[0] || null, // Landmark 0 (Wrist)
        indexTip: landmarks[8] || null, // Landmark 8 (Index Tip)
        thumbTip: landmarks[4] || null, // Landmark 4 (Thumb Tip)
        allLandmarks: landmarks
      };
    }
    
    return { wrist: null, indexTip: null, thumbTip: null, allLandmarks: null };
  }

  public getVideoElement(): HTMLVideoElement {
    return this.videoElement;
  }
}
