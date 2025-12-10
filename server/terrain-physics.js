/**
 * Server-side Terrain Physics Manager
 * Handles procedural terrain collider generation and chunk management
 */

const CONFIG = require('../shared/config.js');
const TerrainNoise = require('../shared/terrain-noise.js');

class TerrainPhysicsManager {
    constructor(physicsWorld) {
        this.physicsWorld = physicsWorld;

        // Track loaded chunks
        this.loadedChunks = new Map();  // "chunkX,chunkZ" -> chunk data
        this.chunkRefCounts = new Map(); // "chunkX,chunkZ" -> reference count

        // Building tracking
        this.buildings = new Map();      // "chunkX,chunkZ" -> building entity IDs

        // Chunk loading queue
        this.loadQueue = [];
        this.unloadQueue = [];
        this.maxChunksPerFrame = 2;

        // Configuration
        this.chunkSize = CONFIG.world.chunkSize;
        this.resolution = CONFIG.world.terrainResolution;
        this.seed = CONFIG.world.seed;
    }

    /**
     * Update terrain based on player positions
     * @param {Array} playerPositions - Array of { entityId, x, z }
     */
    updateForPlayers(playerPositions) {
        const requiredChunks = new Set();
        const chunkRadius = CONFIG.world.serverChunkRadius;

        // Calculate all required chunks based on player positions
        for (const player of playerPositions) {
            const centerChunkX = Math.floor(player.x / this.chunkSize);
            const centerChunkZ = Math.floor(player.z / this.chunkSize);

            for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
                for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
                    const chunkX = centerChunkX + dx;
                    const chunkZ = centerChunkZ + dz;
                    const key = `${chunkX},${chunkZ}`;
                    requiredChunks.add(key);
                }
            }
        }

        // Queue chunks to load
        for (const key of requiredChunks) {
            if (!this.loadedChunks.has(key) && !this.loadQueue.includes(key)) {
                this.loadQueue.push(key);
            }
        }

        // Queue chunks to unload
        for (const key of this.loadedChunks.keys()) {
            if (!requiredChunks.has(key) && !this.unloadQueue.includes(key)) {
                this.unloadQueue.push(key);
            }
        }

        // Process queues
        this.processLoadQueue();
        this.processUnloadQueue();
    }

    /**
     * Process chunk load queue
     */
    processLoadQueue() {
        let loaded = 0;
        while (this.loadQueue.length > 0 && loaded < this.maxChunksPerFrame) {
            const key = this.loadQueue.shift();
            if (!this.loadedChunks.has(key)) {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                this.loadChunk(chunkX, chunkZ);
                loaded++;
            }
        }
    }

    /**
     * Process chunk unload queue
     */
    processUnloadQueue() {
        let unloaded = 0;
        while (this.unloadQueue.length > 0 && unloaded < this.maxChunksPerFrame) {
            const key = this.unloadQueue.shift();
            if (this.loadedChunks.has(key)) {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                this.unloadChunk(chunkX, chunkZ);
                unloaded++;
            }
        }
    }

    /**
     * Load a terrain chunk
     */
    loadChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        if (this.loadedChunks.has(key)) return;

        // Generate heightmap
        const heightmap = TerrainNoise.generateChunkHeightmap(
            chunkX, chunkZ,
            this.chunkSize,
            this.resolution,
            this.seed
        );

        // Create terrain collider
        this.physicsWorld.createTerrainChunk(chunkX, chunkZ, heightmap, this.resolution);

        // Generate and create building colliders
        const buildings = TerrainNoise.getCityBuildings(chunkX, chunkZ, this.chunkSize, this.seed);
        const buildingIds = [];

        for (let i = 0; i < buildings.length; i++) {
            const building = buildings[i];
            const entityId = `building_${chunkX}_${chunkZ}_${i}`;

            this.physicsWorld.createBuildingCollider(
                entityId,
                { x: building.x, y: building.y, z: building.z },
                { width: building.width, height: building.height, depth: building.depth },
                building.rotation
            );

            buildingIds.push(entityId);
        }

        // Store chunk data
        this.loadedChunks.set(key, {
            chunkX,
            chunkZ,
            heightmap,
            buildings: buildingIds
        });

        this.buildings.set(key, buildingIds);
    }

    /**
     * Unload a terrain chunk
     */
    unloadChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const chunkData = this.loadedChunks.get(key);
        if (!chunkData) return;

        // Remove terrain collider
        this.physicsWorld.removeTerrainChunk(chunkX, chunkZ);

        // Remove building colliders
        const buildingIds = this.buildings.get(key) || [];
        for (const entityId of buildingIds) {
            this.physicsWorld.removeEntity(entityId);
        }

        // Clean up tracking
        this.loadedChunks.delete(key);
        this.buildings.delete(key);
    }

    /**
     * Force load chunks around a position (for spawning)
     */
    forceLoadAroundPosition(x, z, radius = 1) {
        const centerChunkX = Math.floor(x / this.chunkSize);
        const centerChunkZ = Math.floor(z / this.chunkSize);

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                this.loadChunk(centerChunkX + dx, centerChunkZ + dz);
            }
        }
    }

    /**
     * Get terrain height at position
     */
    getHeightAt(x, z) {
        return TerrainNoise.getTerrainHeight(x, z, this.seed);
    }

    /**
     * Get terrain normal at position
     */
    getNormalAt(x, z) {
        return TerrainNoise.getTerrainNormal(x, z, this.seed);
    }

    /**
     * Get biome at position
     */
    getBiomeAt(x, z) {
        return TerrainNoise.getBiomeAt(x, z, this.seed);
    }

    /**
     * Get city influence at position
     */
    getCityInfluenceAt(x, z) {
        return TerrainNoise.getCityInfluence(x, z, this.seed);
    }

    /**
     * Find a suitable spawn point
     */
    findSpawnPoint() {
        // Try to find a relatively flat area
        const searchRadius = 5000;
        const attempts = 50;

        let bestPoint = { x: 0, y: 0, z: 0 };
        let bestFlatness = Infinity;

        for (let i = 0; i < attempts; i++) {
            const x = (Math.random() - 0.5) * searchRadius;
            const z = (Math.random() - 0.5) * searchRadius;
            const y = this.getHeightAt(x, z);

            // Check for city (good spawn point)
            const cityInfluence = this.getCityInfluenceAt(x, z);
            if (cityInfluence > 0.3) {
                return { x, y: y + 2, z };
            }

            // Check flatness
            const sampleDist = 5;
            const h1 = this.getHeightAt(x + sampleDist, z);
            const h2 = this.getHeightAt(x - sampleDist, z);
            const h3 = this.getHeightAt(x, z + sampleDist);
            const h4 = this.getHeightAt(x, z - sampleDist);

            const flatness = Math.abs(h1 - y) + Math.abs(h2 - y) + Math.abs(h3 - y) + Math.abs(h4 - y);

            if (flatness < bestFlatness) {
                bestFlatness = flatness;
                bestPoint = { x, y: y + 2, z };
            }
        }

        return bestPoint;
    }

    /**
     * Get spawn points for vehicles in loaded chunks
     */
    getVehicleSpawnPoints(count = 10) {
        const points = [];
        const loadedChunkKeys = Array.from(this.loadedChunks.keys());

        if (loadedChunkKeys.length === 0) return points;

        for (let i = 0; i < count && i < loadedChunkKeys.length * 2; i++) {
            const key = loadedChunkKeys[Math.floor(Math.random() * loadedChunkKeys.length)];
            const [chunkX, chunkZ] = key.split(',').map(Number);

            // Random position within chunk
            const x = chunkX * this.chunkSize + Math.random() * this.chunkSize;
            const z = chunkZ * this.chunkSize + Math.random() * this.chunkSize;
            const y = this.getHeightAt(x, z);

            // Check if not in water and reasonably flat
            if (!TerrainNoise.isWater(x, z, this.seed)) {
                const normal = this.getNormalAt(x, z);
                if (normal.y > 0.8) { // Not too steep
                    points.push({
                        x, y: y + 1, z,
                        rotation: Math.random() * Math.PI * 2
                    });
                }
            }
        }

        return points;
    }

    /**
     * Get chunk data for client
     */
    getChunkDataForClient(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const chunkData = this.loadedChunks.get(key);

        if (!chunkData) {
            // Generate on demand for client
            const heightmap = TerrainNoise.generateChunkHeightmap(
                chunkX, chunkZ,
                this.chunkSize,
                CONFIG.world.renderResolution,
                this.seed
            );

            const buildings = TerrainNoise.getCityBuildings(chunkX, chunkZ, this.chunkSize, this.seed);
            const biome = TerrainNoise.getBiomeAt(
                chunkX * this.chunkSize + this.chunkSize / 2,
                chunkZ * this.chunkSize + this.chunkSize / 2,
                this.seed
            );

            return {
                chunkX,
                chunkZ,
                heightmap: Array.from(heightmap),
                buildings,
                biome
            };
        }

        // Return stored data with render resolution heightmap
        const buildings = TerrainNoise.getCityBuildings(chunkX, chunkZ, this.chunkSize, this.seed);
        const biome = TerrainNoise.getBiomeAt(
            chunkX * this.chunkSize + this.chunkSize / 2,
            chunkZ * this.chunkSize + this.chunkSize / 2,
            this.seed
        );

        // Generate render-resolution heightmap
        const renderHeightmap = TerrainNoise.generateChunkHeightmap(
            chunkX, chunkZ,
            this.chunkSize,
            CONFIG.world.renderResolution,
            this.seed
        );

        return {
            chunkX,
            chunkZ,
            heightmap: Array.from(renderHeightmap),
            buildings,
            biome
        };
    }

    /**
     * Get list of loaded chunk coordinates
     */
    getLoadedChunks() {
        const chunks = [];
        for (const key of this.loadedChunks.keys()) {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            chunks.push({ chunkX, chunkZ });
        }
        return chunks;
    }

    /**
     * Clear all loaded chunks
     */
    clear() {
        for (const key of this.loadedChunks.keys()) {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            this.unloadChunk(chunkX, chunkZ);
        }
        this.loadQueue = [];
        this.unloadQueue = [];
    }
}

module.exports = TerrainPhysicsManager;
