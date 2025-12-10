/**
 * Shared Terrain Noise Generation
 * Used by both server (physics colliders) and client (rendering)
 * Deterministic noise functions for procedural infinite terrain
 */

// Permutation table for Perlin noise
const permutation = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];

const p = new Array(512);
for (let i = 0; i < 256; i++) {
    p[i] = permutation[i];
    p[256 + i] = permutation[i];
}

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t, a, b) {
    return a + t * (b - a);
}

function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * Classic Perlin noise
 */
function perlin(x, y, z = 0) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = fade(x);
    const v = fade(y);
    const w = fade(z);

    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;

    return lerp(w,
        lerp(v,
            lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)),
            lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))
        ),
        lerp(v,
            lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)),
            lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1))
        )
    );
}

/**
 * Fractional Brownian Motion (multi-octave noise)
 */
function fbm(x, y, octaves = 6, lacunarity = 2.0, gain = 0.5) {
    let value = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
        value += amplitude * perlin(x * frequency, y * frequency);
        maxValue += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return value / maxValue;
}

/**
 * Ridge noise for mountain ranges
 */
function ridgeNoise(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let value = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
        let n = perlin(x * frequency, y * frequency);
        n = 1.0 - Math.abs(n);
        n = n * n;
        value += amplitude * n;
        maxValue += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return value / maxValue;
}

/**
 * Domain warping for more organic terrain
 */
function warpedNoise(x, y, warpStrength = 0.5) {
    const warpX = fbm(x + 5.3, y + 1.3, 4) * warpStrength;
    const warpY = fbm(x + 9.2, y + 2.8, 4) * warpStrength;
    return fbm(x + warpX, y + warpY, 6);
}

/**
 * Seeded random for deterministic placement
 */
function seededRandom(seed) {
    let s = seed;
    return function() {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/**
 * Get hash for chunk coordinates (deterministic)
 */
function chunkHash(chunkX, chunkZ) {
    let hash = 17;
    hash = hash * 31 + chunkX;
    hash = hash * 31 + chunkZ;
    return hash;
}

/**
 * Biome calculation based on position
 */
function getBiomeAt(x, z, seed = 7777) {
    const BIOMES = ['wasteland', 'marsh', 'highlands', 'crystal', 'oasis', 'volcanic', 'tundra', 'jungle', 'corrupted', 'bioluminescent'];

    const biomeScale = 0.002;
    const humidity = (fbm(x * biomeScale + seed, z * biomeScale, 4) + 1) * 0.5;
    const temperature = (fbm(x * biomeScale + seed * 2, z * biomeScale + 100, 4) + 1) * 0.5;

    const biomeIndex = Math.floor((humidity * 5 + temperature * 5)) % BIOMES.length;
    return BIOMES[biomeIndex];
}

/**
 * Biome properties for terrain modification
 */
const BIOME_PROPERTIES = {
    wasteland: { altitudeBias: 0, roughness: 0.8, flatness: 0.3 },
    marsh: { altitudeBias: -0.15, roughness: 0.3, flatness: 0.7 },
    highlands: { altitudeBias: 0.25, roughness: 1.0, flatness: 0.2 },
    crystal: { altitudeBias: 0.1, roughness: 0.6, flatness: 0.4 },
    oasis: { altitudeBias: -0.1, roughness: 0.4, flatness: 0.6 },
    volcanic: { altitudeBias: 0.2, roughness: 1.2, flatness: 0.1 },
    tundra: { altitudeBias: 0.05, roughness: 0.5, flatness: 0.5 },
    jungle: { altitudeBias: 0, roughness: 0.7, flatness: 0.4 },
    corrupted: { altitudeBias: -0.05, roughness: 1.1, flatness: 0.2 },
    bioluminescent: { altitudeBias: -0.1, roughness: 0.5, flatness: 0.5 }
};

/**
 * City influence calculation - determines where cities spawn
 */
function getCityInfluence(x, z, seed = 7777) {
    // Large-scale city placement
    const cityScale = 0.001;
    const cityNoise = (fbm(x * cityScale + seed * 3, z * cityScale + seed * 4, 3) + 1) * 0.5;

    // Cities form in clusters
    const threshold = 0.65;
    if (cityNoise < threshold) return 0;

    return (cityNoise - threshold) / (1 - threshold);
}

/**
 * Get city type based on influence
 */
function getCityType(influence) {
    if (influence < 0.25) return 'village';
    if (influence < 0.5) return 'town';
    if (influence < 0.75) return 'city';
    return 'megacity';
}

/**
 * City properties for terrain flattening
 */
const CITY_PROPERTIES = {
    village: { flatRadius: 150, buildingHeight: 8, density: 0.5 },
    town: { flatRadius: 300, buildingHeight: 15, density: 0.65 },
    city: { flatRadius: 600, buildingHeight: 40, density: 0.75 },
    megacity: { flatRadius: 1200, buildingHeight: 100, density: 0.9 }
};

/**
 * Main height sampling function
 * Returns the terrain height at any world position
 */
function getTerrainHeight(x, z, seed = 7777) {
    // Base continental scale
    const continental = fbm(x * 0.0015, z * 0.0015, 4, 2.0, 0.48) * 18;

    // Regional mountains/valleys
    const regional = fbm(x * 0.005, z * 0.005, 5, 2.2, 0.5) * 15;

    // Ridge systems for mountain ranges
    const ridges = ridgeNoise(x * 0.003, z * 0.003, 4, 2.0, 0.5) * 25;

    // Local hills
    const hills = fbm(x * 0.015, z * 0.015, 4, 2.5, 0.5) * 8;

    // Micro detail
    const detail = fbm(x * 0.05, z * 0.05, 3, 2.0, 0.5) * 2;

    // Domain warping for organic feel
    const warp = warpedNoise(x * 0.008, z * 0.008, 0.3) * 10;

    // Combine layers
    let height = continental + regional * 0.7 + ridges * 0.5 + hills + detail + warp;

    // Get biome and apply modifiers
    const biome = getBiomeAt(x, z, seed);
    const biomeProps = BIOME_PROPERTIES[biome];

    height += biomeProps.altitudeBias * 20;
    height *= biomeProps.roughness;

    // Apply flatness (lerp toward average)
    const avgHeight = 10;
    height = lerp(biomeProps.flatness * 0.3, height, avgHeight);

    // City flattening
    const cityInfluence = getCityInfluence(x, z, seed);
    if (cityInfluence > 0) {
        const cityType = getCityType(cityInfluence);
        const cityProps = CITY_PROPERTIES[cityType];
        const flatHeight = 5; // City ground level
        height = lerp(cityInfluence * 0.8, height, flatHeight);
    }

    return height;
}

/**
 * Get terrain normal at position (for physics and rendering)
 */
function getTerrainNormal(x, z, seed = 7777, epsilon = 0.5) {
    const hL = getTerrainHeight(x - epsilon, z, seed);
    const hR = getTerrainHeight(x + epsilon, z, seed);
    const hD = getTerrainHeight(x, z - epsilon, seed);
    const hU = getTerrainHeight(x, z + epsilon, seed);

    // Calculate normal from height differences
    const nx = hL - hR;
    const ny = 2 * epsilon;
    const nz = hD - hU;

    // Normalize
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return {
        x: nx / len,
        y: ny / len,
        z: nz / len
    };
}

/**
 * Generate heightmap for a chunk
 */
function generateChunkHeightmap(chunkX, chunkZ, chunkSize, resolution, seed = 7777) {
    const heightmap = new Float32Array((resolution + 1) * (resolution + 1));
    const worldX = chunkX * chunkSize;
    const worldZ = chunkZ * chunkSize;
    const step = chunkSize / resolution;

    for (let z = 0; z <= resolution; z++) {
        for (let x = 0; x <= resolution; x++) {
            const wx = worldX + x * step;
            const wz = worldZ + z * step;
            heightmap[z * (resolution + 1) + x] = getTerrainHeight(wx, wz, seed);
        }
    }

    return heightmap;
}

/**
 * Check if a position is in water
 */
function isWater(x, z, seed = 7777) {
    const height = getTerrainHeight(x, z, seed);
    const biome = getBiomeAt(x, z, seed);

    // Water level
    const waterLevel = -2;
    return height < waterLevel && (biome === 'marsh' || biome === 'oasis');
}

/**
 * Get spawn points for objects in a chunk
 */
function getChunkSpawnPoints(chunkX, chunkZ, chunkSize, count, seed = 7777) {
    const hash = chunkHash(chunkX, chunkZ) + seed;
    const random = seededRandom(hash);
    const points = [];

    const worldX = chunkX * chunkSize;
    const worldZ = chunkZ * chunkSize;

    for (let i = 0; i < count; i++) {
        const x = worldX + random() * chunkSize;
        const z = worldZ + random() * chunkSize;
        const y = getTerrainHeight(x, z, seed);

        // Skip water areas
        if (!isWater(x, z, seed)) {
            points.push({ x, y, z, rotation: random() * Math.PI * 2 });
        }
    }

    return points;
}

/**
 * Get building positions for a city chunk
 */
function getCityBuildings(chunkX, chunkZ, chunkSize, seed = 7777) {
    const worldX = chunkX * chunkSize;
    const worldZ = chunkZ * chunkSize;
    const centerX = worldX + chunkSize / 2;
    const centerZ = worldZ + chunkSize / 2;

    const cityInfluence = getCityInfluence(centerX, centerZ, seed);
    if (cityInfluence < 0.1) return [];

    const cityType = getCityType(cityInfluence);
    const cityProps = CITY_PROPERTIES[cityType];

    const hash = chunkHash(chunkX, chunkZ) + seed * 5;
    const random = seededRandom(hash);

    const buildings = [];
    const gridSize = 25;
    const halfChunk = chunkSize / 2;

    for (let gx = -halfChunk; gx < halfChunk; gx += gridSize) {
        for (let gz = -halfChunk; gz < halfChunk; gz += gridSize) {
            if (random() < cityProps.density) {
                const x = worldX + halfChunk + gx + (random() - 0.5) * gridSize * 0.3;
                const z = worldZ + halfChunk + gz + (random() - 0.5) * gridSize * 0.3;
                const y = getTerrainHeight(x, z, seed);

                const width = 8 + random() * 12;
                const depth = 8 + random() * 12;
                const height = 5 + random() * cityProps.buildingHeight * cityInfluence;

                buildings.push({
                    x, y, z,
                    width, depth, height,
                    rotation: Math.floor(random() * 4) * Math.PI / 2
                });
            }
        }
    }

    return buildings;
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        perlin,
        fbm,
        ridgeNoise,
        warpedNoise,
        seededRandom,
        chunkHash,
        getBiomeAt,
        getCityInfluence,
        getCityType,
        getTerrainHeight,
        getTerrainNormal,
        generateChunkHeightmap,
        isWater,
        getChunkSpawnPoints,
        getCityBuildings,
        BIOME_PROPERTIES,
        CITY_PROPERTIES
    };
} else if (typeof window !== 'undefined') {
    window.TerrainNoise = {
        perlin,
        fbm,
        ridgeNoise,
        warpedNoise,
        seededRandom,
        chunkHash,
        getBiomeAt,
        getCityInfluence,
        getCityType,
        getTerrainHeight,
        getTerrainNormal,
        generateChunkHeightmap,
        isWater,
        getChunkSpawnPoints,
        getCityBuildings,
        BIOME_PROPERTIES,
        CITY_PROPERTIES
    };
}
