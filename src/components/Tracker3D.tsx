import { useEffect, useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import { FACE_CONNECTIONS_SIMPLIFIED, HAND_CONNECTIONS } from '../utils/connections';

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface TrackerState {
  faceLandmarks: Landmark[] | null;
  leftHandLandmarks: Landmark[] | null;
  rightHandLandmarks: Landmark[] | null;
}

export default function Tracker3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const faceGroupRef = useRef<THREE.Group | null>(null);
  const leftHandGroupRef = useRef<THREE.Group | null>(null);
  const rightHandGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);
  const detectFrameRef = useRef<number>(0);
  const isRunningRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string>('Click to start');
  const [fps, setFps] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [handsDetected, setHandsDetected] = useState(false);
  const trackerStateRef = useRef<TrackerState>({
    faceLandmarks: null,
    leftHandLandmarks: null,
    rightHandLandmarks: null,
  });

  // Three.js scene setup
  const initScene = useCallback(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create groups for face and hands
    const faceGroup = new THREE.Group();
    scene.add(faceGroup);
    faceGroupRef.current = faceGroup;

    const leftHandGroup = new THREE.Group();
    scene.add(leftHandGroup);
    leftHandGroupRef.current = leftHandGroup;

    const rightHandGroup = new THREE.Group();
    scene.add(rightHandGroup);
    rightHandGroupRef.current = rightHandGroup;

    // Add grid helper for depth reference
    const gridHelper = new THREE.GridHelper(10, 20, 0x111133, 0x111133);
    gridHelper.position.y = -2.5;
    scene.add(gridHelper);

    // Add subtle particle background
    const particleGeometry = new THREE.BufferGeometry();
    const particleCount = 300;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 20;
      positions[i + 1] = (Math.random() - 0.5) * 20;
      positions[i + 2] = (Math.random() - 0.5) * 10 - 5;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x3344ff,
      size: 0.015,
      transparent: true,
      opacity: 0.4,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);
  }, []);

  // Update 3D landmarks
  const updateLandmarks = useCallback((
    landmarks: Landmark[],
    group: THREE.Group,
    connections: [number, number][],
    color: number,
    glowColor: number,
    offsetX: number = 0,
    offsetY: number = 0,
    scale: number = 3
  ) => {
    // Clear previous
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }

    // Create dots (landmarks)
    const dotGeometry = new THREE.SphereGeometry(0.02, 6, 6);
    const dotMaterial = new THREE.MeshBasicMaterial({ color });
    const glowGeometry = new THREE.SphereGeometry(0.035, 6, 6);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.25,
    });

    const positions: THREE.Vector3[] = [];

    for (const landmark of landmarks) {
      // Mirror X for natural view
      const x = -(landmark.x - 0.5) * scale + offsetX;
      const y = -(landmark.y - 0.5) * scale + offsetY;
      const z = -landmark.z * scale * 2;

      positions.push(new THREE.Vector3(x, y, z));

      // Main dot
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      dot.position.set(x, y, z);
      group.add(dot);

      // Glow dot
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.set(x, y, z);
      group.add(glow);
    }

    // Create connections (lines)
    const lineMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
    });

    for (const [i, j] of connections) {
      if (i < positions.length && j < positions.length) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          positions[i],
          positions[j],
        ]);
        const line = new THREE.Line(geometry, lineMaterial);
        group.add(line);
      }
    }
  }, []);

  // Clear a group
  const clearGroup = useCallback((group: THREE.Group) => {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }, []);

  // Animation loop
  const animate = useCallback(() => {
    animFrameRef.current = requestAnimationFrame(animate);

    if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;

    const state = trackerStateRef.current;

    // Update face
    if (state.faceLandmarks && faceGroupRef.current) {
      updateLandmarks(
        state.faceLandmarks,
        faceGroupRef.current,
        FACE_CONNECTIONS_SIMPLIFIED,
        0x00ffaa,
        0x00ff88,
        0,
        0.3,
        4
      );
    } else if (faceGroupRef.current && faceGroupRef.current.children.length > 0) {
      clearGroup(faceGroupRef.current);
    }

    // Update left hand
    if (state.leftHandLandmarks && leftHandGroupRef.current) {
      updateLandmarks(
        state.leftHandLandmarks,
        leftHandGroupRef.current,
        HAND_CONNECTIONS,
        0x4488ff,
        0x4488ff,
        -2.5,
        -1.5,
        2.5
      );
    } else if (leftHandGroupRef.current && leftHandGroupRef.current.children.length > 0) {
      clearGroup(leftHandGroupRef.current);
    }

    // Update right hand
    if (state.rightHandLandmarks && rightHandGroupRef.current) {
      updateLandmarks(
        state.rightHandLandmarks,
        rightHandGroupRef.current,
        HAND_CONNECTIONS,
        0xff4488,
        0xff4488,
        2.5,
        -1.5,
        2.5
      );
    } else if (rightHandGroupRef.current && rightHandGroupRef.current.children.length > 0) {
      clearGroup(rightHandGroupRef.current);
    }

    // Gentle rotation for 3D effect
    const time = Date.now() * 0.001;
    if (faceGroupRef.current) {
      faceGroupRef.current.rotation.y = Math.sin(time * 0.3) * 0.08;
      faceGroupRef.current.rotation.x = Math.sin(time * 0.2) * 0.03;
    }
    if (leftHandGroupRef.current) {
      leftHandGroupRef.current.rotation.y = Math.sin(time * 0.4) * 0.05;
    }
    if (rightHandGroupRef.current) {
      rightHandGroupRef.current.rotation.y = Math.sin(time * 0.4 + 1) * 0.05;
    }

    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, [updateLandmarks, clearGroup]);

  // MediaPipe setup
  const startTracking = useCallback(async () => {
    if (isRunningRef.current) return;

    try {
      setStatus('Loading AI models...');

      const vision = await import('@mediapipe/tasks-vision');
      const { FaceLandmarker, HandLandmarker, FilesetResolver } = vision;

      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      setStatus('Loading face model...');

      // Create face landmarker
      const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

      setStatus('Loading hand model...');

      // Create hand landmarker
      const handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });

      setStatus('Requesting camera...');

      // Setup video
      const video = videoRef.current;
      if (!video) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });

      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
        video.play();
      });

      setStatus('Tracking active');
      isRunningRef.current = true;
      setIsRunning(true);

      let lastTime = performance.now();
      let frameCount = 0;

      // Detection loop
      const detect = () => {
        if (!isRunningRef.current) return;

        const now = performance.now();
        frameCount++;

        if (now - lastTime >= 1000) {
          setFps(frameCount);
          frameCount = 0;
          lastTime = now;
        }

        if (video.readyState >= 2) {
          const timestamp = performance.now();

          try {
            // Detect face
            const faceResult = faceLandmarker.detectForVideo(video, timestamp);
            if (faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
              trackerStateRef.current.faceLandmarks = faceResult.faceLandmarks[0] as Landmark[];
              setFaceDetected(true);
            } else {
              trackerStateRef.current.faceLandmarks = null;
              setFaceDetected(false);
            }

            // Detect hands
            const handResult = handLandmarker.detectForVideo(video, timestamp);
            trackerStateRef.current.leftHandLandmarks = null;
            trackerStateRef.current.rightHandLandmarks = null;

            if (handResult.landmarks && handResult.landmarks.length > 0) {
              for (let i = 0; i < handResult.landmarks.length; i++) {
                // MediaPipe reports handedness from camera perspective (mirrored)
                // "Left" in camera = person's right hand
                const handedness = handResult.handedness?.[i]?.[0]?.categoryName;
                if (handedness === 'Left') {
                  // Camera's left = person's right
                  trackerStateRef.current.rightHandLandmarks = handResult.landmarks[i] as Landmark[];
                } else {
                  // Camera's right = person's left
                  trackerStateRef.current.leftHandLandmarks = handResult.landmarks[i] as Landmark[];
                }
              }
              setHandsDetected(true);
            } else {
              setHandsDetected(false);
            }
          } catch (e) {
            // Skip frame on error
            console.warn('Detection error:', e);
          }
        }

        detectFrameRef.current = requestAnimationFrame(detect);
      };

      detect();
    } catch (err) {
      console.error('Error starting tracking:', err);
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      isRunningRef.current = false;
      setIsRunning(false);
    }
  }, []);

  // Initialize
  useEffect(() => {
    initScene();
    animate();

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (detectFrameRef.current) {
        cancelAnimationFrame(detectFrameRef.current);
      }
      isRunningRef.current = false;
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [initScene, animate]);

  return (
    <div className="relative w-full h-screen bg-[#0a0a0f] overflow-hidden">
      {/* Hidden video element - never shown to user */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        muted
      />

      {/* 3D Canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* UI Overlay - Header */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start pointer-events-none z-10">
        <div>
          <h1 className="text-xl font-bold text-white/90 tracking-wider flex items-center gap-2">
            <span className="text-cyan-400">◆</span>
            <span>3D MOTION TRACKER</span>
          </h1>
          <p className="text-xs text-white/40 mt-1 ml-5">Face & Hand Landmark Detection System</p>
        </div>

        <div className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-xs text-white/60">{status}</span>
          </div>
          {fps > 0 && (
            <p className="text-xs text-white/40 mt-1">{fps} FPS • Real-time 3D</p>
          )}
        </div>
      </div>

      {/* Start Button */}
      {!isRunning && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
          <div className="relative">
            {/* Animated ring */}
            <div className="absolute inset-0 -m-8 rounded-full border border-cyan-500/20 animate-ping" />
            <div className="absolute inset-0 -m-12 rounded-full border border-blue-500/10 animate-pulse" />
            
            <button
              onClick={startTracking}
              className="relative px-10 py-5 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 text-white font-semibold rounded-2xl
                shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-105 transition-all duration-300
                border border-cyan-400/40 backdrop-blur-sm group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center group-hover:bg-cyan-500/30 transition-colors">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold">Start Tracking</div>
                  <div className="text-xs text-white/50">Camera required</div>
                </div>
              </div>
            </button>
          </div>
          
          <div className="mt-8 text-center max-w-sm">
            <p className="text-white/30 text-sm">
              🔒 Privacy-first: Your camera feed is never displayed.
              <br />
              Only 3D wireframe landmarks are rendered.
            </p>
          </div>

          <div className="mt-6 flex gap-6 text-xs text-white/20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400/60" />
              <span>Face Mesh (468 points)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-400/60" />
              <span>Hand Tracking (21 points)</span>
            </div>
          </div>
        </div>
      )}

      {/* Info Panel - Bottom */}
      <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none z-10">
        <div className="bg-black/50 backdrop-blur-md rounded-xl p-3 border border-white/10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" />
              <span className="text-xs text-white/70">Face</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-400 shadow-lg shadow-blue-400/50" />
              <span className="text-xs text-white/70">Left Hand</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-pink-400 shadow-lg shadow-pink-400/50" />
              <span className="text-xs text-white/70">Right Hand</span>
            </div>
          </div>
        </div>

        <div className="bg-black/50 backdrop-blur-md rounded-xl p-3 border border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${faceDetected ? 'bg-emerald-400' : 'bg-white/30'}`} />
              <span className="text-xs text-white/50">
                {faceDetected ? 'Face tracked' : 'No face'}
              </span>
            </div>
            <span className="text-white/20">|</span>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${handsDetected ? 'bg-blue-400' : 'bg-white/30'}`} />
              <span className="text-xs text-white/50">
                {handsDetected ? 'Hands tracked' : 'No hands'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative corner elements */}
      <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-cyan-500/20 pointer-events-none z-10" />
      <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-cyan-500/20 pointer-events-none z-10" />
      <div className="absolute bottom-0 left-0 w-16 h-16 border-b-2 border-l-2 border-cyan-500/20 pointer-events-none z-10" />
      <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-cyan-500/20 pointer-events-none z-10" />

      {/* Scan line effect */}
      {isRunning && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-5">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/[0.03] to-transparent animate-scan" />
        </div>
      )}

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)'
        }}
      />
    </div>
  );
}
