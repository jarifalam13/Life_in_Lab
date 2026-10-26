// Canvas drawings of the two marine animals on the 2025 course (reef shark,
// sawfish), used for the vinyl prints on the gate, bin, board and octagon.

import * as THREE from 'three';
// prints from the competition team handbook figures
import sharkJpg from '../../assets/shark.jpg';
import sawfishJpg from '../../assets/sawfish.jpg';
import binSharkJpg from '../../assets/bin-shark.jpg';
import binSawfishJpg from '../../assets/bin-sawfish.jpg';
import boardSharkTopJpg from '../../assets/board-shark-top.jpg';
import boardSawfishTopJpg from '../../assets/board-sawfish-top.jpg';

export const IMAGES = { shark: sharkJpg, sawfish: sawfishJpg, binShark: binSharkJpg, binSawfish: binSawfishJpg, boardSharkTop: boardSharkTopJpg, boardSawfishTop: boardSawfishTopJpg };

const loader = new THREE.TextureLoader();
const texCache = {};
export function imageTexture(key) {
  if (texCache[key]) return texCache[key];
  const t = loader.load(IMAGES[key]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (texCache[key] = t);
}

export function drawAnimal(g, animal, cx, cy, size, flip = false) {
  g.save();
  g.translate(cx, cy);
  if (flip) g.scale(-1, 1);
  const s = size / 200;
  g.scale(s, s);
  g.lineJoin = 'round';
  if (animal === 'shark') {
    // grey reef shark, side view, facing right
    g.fillStyle = '#6f7f8c';
    g.beginPath();
    g.moveTo(95, 0);
    g.quadraticCurveTo(70, -26, 0, -24);
    g.lineTo(-10, -30); g.lineTo(-22, -62); g.lineTo(-36, -24); // dorsal fin
    g.quadraticCurveTo(-60, -18, -72, -8);
    g.lineTo(-100, -40); g.lineTo(-92, 0); g.lineTo(-106, 34); g.lineTo(-74, 8); // tail
    g.quadraticCurveTo(-40, 22, 0, 22);
    g.lineTo(-6, 26); g.lineTo(-30, 46); g.lineTo(-14, 22); // pectoral fin
    g.quadraticCurveTo(60, 24, 95, 0);
    g.fill();
    g.fillStyle = '#e9eef2';
    g.beginPath(); g.moveTo(88, 4); g.quadraticCurveTo(50, 20, -40, 14); g.quadraticCurveTo(20, 8, 88, 4); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(62, -6, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#4a5560'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(40 - i * 6, -10); g.lineTo(37 - i * 6, 6); g.stroke(); }
    g.fillStyle = '#2c3640'; g.beginPath(); g.moveTo(-100, -40); g.lineTo(-92, 0); g.lineTo(-84, -14); g.fill();
  } else {
    // sawfish: flat body, long toothed rostrum, facing right
    g.fillStyle = '#9a7f5f';
    g.beginPath();
    g.moveTo(40, -6);
    g.quadraticCurveTo(10, -22, -30, -18);
    g.lineTo(-38, -40); g.lineTo(-50, -18);
    g.quadraticCurveTo(-75, -12, -86, -6);
    g.lineTo(-104, -30); g.lineTo(-98, 0); g.lineTo(-104, 24); g.lineTo(-86, 6);
    g.quadraticCurveTo(-30, 18, 40, 6);
    g.fill();
    // pectoral fins
    g.beginPath(); g.moveTo(10, 6); g.lineTo(-14, 34); g.lineTo(-20, 8); g.fill();
    // saw
    g.fillStyle = '#b39a78';
    g.fillRect(36, -4, 66, 8);
    g.fillStyle = '#f4efe4';
    for (let x = 42; x < 102; x += 8) {
      g.beginPath(); g.moveTo(x, -4); g.lineTo(x + 2, -11); g.lineTo(x + 4, -4); g.fill();
      g.beginPath(); g.moveTo(x, 4); g.lineTo(x + 2, 11); g.lineTo(x + 4, 4); g.fill();
    }
    g.fillStyle = '#111'; g.beginPath(); g.arc(28, -8, 3.5, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// gate / octagon print (12 in square) and the bin halves
export function animalTexture(animal, where = 'gate') {
  if (where === 'bin') return imageTexture(animal === 'shark' ? 'binShark' : 'binSawfish');
  return imageTexture(animal);
}

// small icon as a data URL for the HUD / menus
export function animalIcon(animal) {
  return animal === 'shark' ? binSharkJpg : binSawfishJpg;
}
