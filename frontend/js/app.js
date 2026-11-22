/**
 * Builders Archive — Traditional Web Tech Stack
 * Clean, standard ES6+ TypeScript / JavaScript implementation with Three.js.
 */

(function () {
  'use strict';

  // --- AIChatInput Component Logic ---
  function initAIChatInput() {
    const textarea = document.getElementById('chatInputTextarea');
    const sendBtn = document.getElementById('chatSendBtn');
    const plusBtn = document.getElementById('chatPlusBtn');
    const micBtn = document.getElementById('chatMicBtn');

    if (!textarea || !sendBtn) return;

    let message = "";

    function handleSend() {
      const trimmed = textarea.value.trim();
      if (!trimmed) return;

      console.log("Message sent:", trimmed);

      // Reset state
      message = "";
      textarea.value = "";
      sendBtn.disabled = true;

      // Reset textarea height if it was auto-expanded
      textarea.style.height = 'auto';
    }

    // Input change handler
    textarea.addEventListener('input', function () {
      message = textarea.value;
      sendBtn.disabled = !message.trim();

      // Auto expand slightly for multiple lines
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 180) + 'px';
    });

    // Keydown handler: Enter to send, Shift+Enter for new line
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Send button click
    sendBtn.addEventListener('click', function () {
      handleSend();
    });

    // Plus button click
    if (plusBtn) {
      plusBtn.addEventListener('click', function () {
        console.log("Plus action clicked: attach file / context");
      });
    }

    // Mic button click
    if (micBtn) {
      micBtn.addEventListener('click', function () {
        console.log("Mic action clicked: voice input");
      });
    }
  }

  // --- Traditional Three.js Scene Setup ---
  function initThreeScene() {
    const container = document.getElementById('three-canvas-container');
    if (!container) return null;

    // Check if THREE is loaded globally or via module
    if (typeof THREE === 'undefined') {
      console.log("Three.js ready to load via module or CDN.");
      return null;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0); // Transparent black

    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onWindowResize);

    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    return { scene, camera, renderer };
  }

  // Initialize on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initAIChatInput();
      initThreeScene();
    });
  } else {
    initAIChatInput();
    initThreeScene();
  }
})();
