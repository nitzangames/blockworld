// Filled in incrementally. For now, prove three.js + canvas are wired.
const THREE = window.THREE;
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
renderer.setClearColor(0x9ec7e8);
renderer.setSize(window.innerWidth, window.innerHeight, false);
