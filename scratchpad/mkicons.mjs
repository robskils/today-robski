import sharp from 'sharp';
import { readFileSync } from 'fs';
const svg = readFileSync('public/favicon.svg');
const out = [['public/icon-192.v18.png',192],['public/icon-512.v18.png',512],['public/apple-touch-icon.v18.png',180]];
for (const [p,s] of out) { await sharp(svg,{density:600}).resize(s,s).png().toFile(p); console.log('wrote',p); }
