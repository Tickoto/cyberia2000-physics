/**
 * Client-side Terrain Renderer
 * Renders terrain chunks using data from server or local generation
 */

class TerrainRenderer {
    constructor(scene, networkClient) {
        this.scene = scene;
        this.networkClient = networkClient;

        // Chunk management
        this.chunks = new Map();         // "chunkX,chunkZ" -> { mesh, buildings, flora }
        this.loadedChunks = new Set();
        this.loadingChunks = new Set();

        // Configuration
        this.chunkSize = CONFIG.world.chunkSize;
        this.renderDistance = CONFIG.world.clientChunkRadius;
        this.renderResolution = CONFIG.world.renderResolution;

        // Materials
        this.terrainMaterial = this.createTerrainMaterial();
        this.buildingMaterial = this.createBuildingMaterial();

        // Biome colors
        this.biomeColors = {
            wasteland: 0xd4a574,
            marsh: 0x4a6741,
            highlands: 0x7a8b6e,
            crystal: 0x88aacc,
            oasis: 0x8bc34a,
            volcanic: 0xd84315,
            tundra: 0xb0c4de,
            jungle: 0x228b22,
            corrupted: 0x9932cc,
            bioluminescent: 0x00ff88
        };
    }

    /**
     * Create terrain material
     */
    createTerrainMaterial() {
        return new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.1,
            flatShading: true
        });
    }

    /**
     * Create building material
     */
    createBuildingMaterial() {
        return new THREE.MeshStandardMaterial({
            color: 0x444455,
            roughness: 0.7,
            metalness: 0.3
        });
    }

    /**
     * Update terrain based on player position
     */
    update(playerPosition) {
        const centerChunkX = Math.floor(playerPosition.x / this.chunkSize);
        const centerChunkZ = Math.floor(playerPosition.z / this.chunkSize);

        const requiredChunks = new Set();

        // Determine required chunks
        for (let dx = -this.renderDistance; dx <= this.renderDistance; dx++) {
            for (let dz = -this.renderDistance; dz <= this.renderDistance; dz++) {
                const chunkX = centerChunkX + dx;
                const chunkZ = centerChunkZ + dz;
                const key = `${chunkX},${chunkZ}`;
                requiredChunks.add(key);

                // Request chunk from server if not loaded
                if (!this.loadedChunks.has(key) && !this.loadingChunks.has(key)) {
                    this.requestChunk(chunkX, chunkZ);
                }
            }
        }

        // Unload distant chunks
        for (const key of this.loadedChunks) {
            if (!requiredChunks.has(key)) {
                this.unloadChunk(key);
            }
        }

        // Clear old chunk data from network client
        this.networkClient.clearOldChunks(Array.from(requiredChunks));
    }

    /**
     * Request chunk data from server
     */
    requestChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        this.loadingChunks.add(key);
        this.networkClient.requestChunk(chunkX, chunkZ);
    }

    /**
     * Handle received chunk data
     */
    handleChunkData(data) {
        const key = `${data.chunkX},${data.chunkZ}`;
        this.loadingChunks.delete(key);

        if (this.loadedChunks.has(key)) return;

        // Create chunk mesh
        this.createChunkMesh(data);
        this.loadedChunks.add(key);
    }

    /**
     * Create mesh for terrain chunk
     */
    createChunkMesh(data) {
        const { chunkX, chunkZ, heightmap, buildings, biome } = data;
        const key = `${chunkX},${chunkZ}`;

        const worldX = chunkX * this.chunkSize;
        const worldZ = chunkZ * this.chunkSize;

        // Create terrain geometry
        const geometry = new THREE.PlaneGeometry(
            this.chunkSize,
            this.chunkSize,
            this.renderResolution,
            this.renderResolution
        );

        // Apply heightmap
        const positions = geometry.attributes.position.array;
        const colors = new Float32Array(positions.length);

        const biomeColor = new THREE.Color(this.biomeColors[biome] || 0x888888);
        const resolution = this.renderResolution + 1;

        for (let i = 0; i < positions.length; i += 3) {
            const vertexIndex = i / 3;
            const x = vertexIndex % resolution;
            const z = Math.floor(vertexIndex / resolution);

            // Get height from heightmap
            const height = heightmap[z * resolution + x] || 0;

            // Set vertex position (plane is XY, rotate to XZ)
            positions[i + 2] = height;

            // Calculate color based on height and biome
            const heightFactor = Math.min(1, Math.max(0, (height + 10) / 50));
            const slopeFactor = this.calculateSlopeFactor(heightmap, x, z, resolution);

            // Blend biome color with height-based shading
            const r = biomeColor.r * (0.7 + heightFactor * 0.3) * (0.8 + slopeFactor * 0.2);
            const g = biomeColor.g * (0.7 + heightFactor * 0.3) * (0.8 + slopeFactor * 0.2);
            const b = biomeColor.b * (0.7 + heightFactor * 0.3) * (0.8 + slopeFactor * 0.2);

            colors[i] = Math.min(1, r);
            colors[i + 1] = Math.min(1, g);
            colors[i + 2] = Math.min(1, b);
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        // Create mesh
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(worldX + this.chunkSize / 2, 0, worldZ + this.chunkSize / 2);
        mesh.receiveShadow = true;

        this.scene.add(mesh);

        // Create building meshes
        const buildingMeshes = [];
        for (const building of buildings) {
            const buildingMesh = this.createBuildingMesh(building);
            buildingMeshes.push(buildingMesh);
            this.scene.add(buildingMesh);
        }

        // Store chunk data
        this.chunks.set(key, {
            mesh,
            buildings: buildingMeshes,
            flora: []
        });
    }

    /**
     * Calculate slope factor for vertex coloring
     */
    calculateSlopeFactor(heightmap, x, z, resolution) {
        if (x <= 0 || x >= resolution - 1 || z <= 0 || z >= resolution - 1) {
            return 0.5;
        }

        const h = heightmap[z * resolution + x];
        const hL = heightmap[z * resolution + (x - 1)];
        const hR = heightmap[z * resolution + (x + 1)];
        const hU = heightmap[(z - 1) * resolution + x];
        const hD = heightmap[(z + 1) * resolution + x];

        const slope = Math.abs(hL - hR) + Math.abs(hU - hD);
        return Math.min(1, slope / 10);
    }

    /**
     * Create building mesh
     */
    createBuildingMesh(building) {
        const { x, y, z, width, height, depth, rotation } = building;

        // Building geometry
        const geometry = new THREE.BoxGeometry(width, height, depth);

        // Randomize building color slightly
        const colorVariation = 0.1;
        const r = 0.27 + (Math.random() - 0.5) * colorVariation;
        const g = 0.27 + (Math.random() - 0.5) * colorVariation;
        const b = 0.33 + (Math.random() - 0.5) * colorVariation;

        const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(r, g, b),
            roughness: 0.7,
            metalness: 0.3
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y + height / 2, z);
        mesh.rotation.y = rotation;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Add windows
        this.addBuildingDetails(mesh, width, height, depth);

        return mesh;
    }

    /**
     * Add details to building
     */
    addBuildingDetails(buildingMesh, width, height, depth) {
        const windowGeometry = new THREE.PlaneGeometry(1, 1.5);
        const windowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffcc,
            transparent: true,
            opacity: 0.8
        });

        const windowRows = Math.floor(height / 4);
        const windowColsW = Math.floor(width / 3);
        const windowColsD = Math.floor(depth / 3);

        // Front and back windows
        for (let row = 0; row < windowRows; row++) {
            for (let col = 0; col < windowColsD; col++) {
                const wy = -height / 2 + 2 + row * 4;
                const wz = -depth / 2 + 2 + col * 3;

                // Front
                const windowFront = new THREE.Mesh(windowGeometry, windowMaterial);
                windowFront.position.set(-width / 2 - 0.01, wy, wz);
                windowFront.rotation.y = Math.PI / 2;
                buildingMesh.add(windowFront);

                // Back
                const windowBack = new THREE.Mesh(windowGeometry, windowMaterial);
                windowBack.position.set(width / 2 + 0.01, wy, wz);
                windowBack.rotation.y = -Math.PI / 2;
                buildingMesh.add(windowBack);
            }
        }

        // Side windows
        for (let row = 0; row < windowRows; row++) {
            for (let col = 0; col < windowColsW; col++) {
                const wy = -height / 2 + 2 + row * 4;
                const wx = -width / 2 + 2 + col * 3;

                // Left
                const windowLeft = new THREE.Mesh(windowGeometry, windowMaterial);
                windowLeft.position.set(wx, wy, -depth / 2 - 0.01);
                buildingMesh.add(windowLeft);

                // Right
                const windowRight = new THREE.Mesh(windowGeometry, windowMaterial);
                windowRight.position.set(wx, wy, depth / 2 + 0.01);
                windowRight.rotation.y = Math.PI;
                buildingMesh.add(windowRight);
            }
        }
    }

    /**
     * Unload chunk
     */
    unloadChunk(key) {
        const chunk = this.chunks.get(key);
        if (!chunk) return;

        // Remove terrain mesh
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();

        // Remove buildings
        for (const building of chunk.buildings) {
            this.scene.remove(building);
            building.geometry.dispose();
            building.material.dispose();
        }

        // Remove flora
        for (const flora of chunk.flora) {
            this.scene.remove(flora);
            flora.geometry.dispose();
            flora.material.dispose();
        }

        this.chunks.delete(key);
        this.loadedChunks.delete(key);
    }

    /**
     * Get terrain height at position (client-side estimation)
     */
    getHeightAt(x, z) {
        // Use TerrainNoise for local height calculation
        if (typeof TerrainNoise !== 'undefined') {
            return TerrainNoise.getTerrainHeight(x, z, CONFIG.world.seed);
        }
        return 0;
    }

    /**
     * Get biome at position
     */
    getBiomeAt(x, z) {
        if (typeof TerrainNoise !== 'undefined') {
            return TerrainNoise.getBiomeAt(x, z, CONFIG.world.seed);
        }
        return 'wasteland';
    }

    /**
     * Check if position is in loaded chunk
     */
    isPositionLoaded(x, z) {
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(z / this.chunkSize);
        return this.loadedChunks.has(`${chunkX},${chunkZ}`);
    }

    /**
     * Get loaded chunk count
     */
    getLoadedChunkCount() {
        return this.loadedChunks.size;
    }

    /**
     * Dispose all resources
     */
    dispose() {
        for (const key of this.loadedChunks) {
            this.unloadChunk(key);
        }
        this.terrainMaterial.dispose();
        this.buildingMaterial.dispose();
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.TerrainRenderer = TerrainRenderer;
}
