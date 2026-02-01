const sharp = require('sharp');
const path = require('path');

const assetsDir = path.join(__dirname, '../assets');

// Create a crypto-themed icon with a chart/signal design
async function createIcon(size, filename) {
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1a1a2e"/>
          <stop offset="100%" style="stop-color:#0f0f1a"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#00d4aa"/>
          <stop offset="100%" style="stop-color:#00ff88"/>
        </linearGradient>
      </defs>

      <!-- Background -->
      <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#bg)"/>

      <!-- Outer ring -->
      <circle cx="${size/2}" cy="${size/2}" r="${size * 0.38}" fill="none" stroke="#2a2a4a" stroke-width="${size * 0.02}"/>

      <!-- Inner glow circle -->
      <circle cx="${size/2}" cy="${size/2}" r="${size * 0.32}" fill="none" stroke="url(#accent)" stroke-width="${size * 0.015}" opacity="0.3"/>

      <!-- Signal chart line (going up) -->
      <polyline
        points="${size * 0.25},${size * 0.65} ${size * 0.35},${size * 0.55} ${size * 0.45},${size * 0.6} ${size * 0.55},${size * 0.4} ${size * 0.65},${size * 0.45} ${size * 0.75},${size * 0.3}"
        fill="none"
        stroke="url(#accent)"
        stroke-width="${size * 0.04}"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- Signal dot at the end -->
      <circle cx="${size * 0.75}" cy="${size * 0.3}" r="${size * 0.05}" fill="#00d4aa"/>
      <circle cx="${size * 0.75}" cy="${size * 0.3}" r="${size * 0.08}" fill="#00d4aa" opacity="0.3"/>

      <!-- Dollar sign -->
      <text x="${size/2}" y="${size * 0.82}" font-family="Arial, sans-serif" font-size="${size * 0.12}" font-weight="bold" fill="#00d4aa" text-anchor="middle">$</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(assetsDir, filename));

  console.log(`Created ${filename} (${size}x${size})`);
}

// Create splash screen
async function createSplash() {
  const width = 1284;
  const height = 2778;

  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#1a1a2e"/>
          <stop offset="100%" style="stop-color:#0f0f1a"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#00d4aa"/>
          <stop offset="100%" style="stop-color:#00ff88"/>
        </linearGradient>
      </defs>

      <!-- Background -->
      <rect width="${width}" height="${height}" fill="url(#bg)"/>

      <!-- Logo circle -->
      <circle cx="${width/2}" cy="${height * 0.4}" r="180" fill="none" stroke="#2a2a4a" stroke-width="8"/>
      <circle cx="${width/2}" cy="${height * 0.4}" r="150" fill="none" stroke="url(#accent)" stroke-width="4" opacity="0.3"/>

      <!-- Signal chart -->
      <polyline
        points="${width/2 - 100},${height * 0.4 + 40} ${width/2 - 50},${height * 0.4} ${width/2},${height * 0.4 + 20} ${width/2 + 50},${height * 0.4 - 40} ${width/2 + 100},${height * 0.4 - 60}"
        fill="none"
        stroke="url(#accent)"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- Signal dot -->
      <circle cx="${width/2 + 100}" cy="${height * 0.4 - 60}" r="20" fill="#00d4aa"/>
      <circle cx="${width/2 + 100}" cy="${height * 0.4 - 60}" r="35" fill="#00d4aa" opacity="0.3"/>

      <!-- App name -->
      <text x="${width/2}" y="${height * 0.55}" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="#ffffff" text-anchor="middle">Criterio Trading</text>
      <text x="${width/2}" y="${height * 0.58}" font-family="Arial, sans-serif" font-size="32" fill="#00d4aa" text-anchor="middle">by austin</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(assetsDir, 'splash.png'));

  console.log(`Created splash.png (${width}x${height})`);
}

async function main() {
  console.log('Generating app icons...\n');

  await createIcon(1024, 'icon.png');
  await createIcon(1024, 'adaptive-icon.png');
  await createSplash();

  console.log('\nDone! Icons created in assets/');
}

main().catch(console.error);
