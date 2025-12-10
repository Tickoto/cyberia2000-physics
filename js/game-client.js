/**
 * Main Game Client
 * Entry point for the Cyberia 2000 networked physics client
 */

class GameClient {
    constructor() {
        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Game components
        this.networkClient = null;
        this.terrainRenderer = null;
        this.vehicleRenderer = null;
        this.playerController = null;

        // Game state
        this.isRunning = false;
        this.lastFrameTime = 0;

        // UI elements
        this.loadingScreen = null;
        this.gameUI = null;

        // Server URL
        this.serverUrl = 'ws://localhost:8080';

        // Player info
        this.username = 'Player';
        this.appearance = {};
    }

    /**
     * Initialize the game
     */
    async init() {
        console.log('[Game] Initializing...');

        // Setup Three.js
        this.setupThreeJS();

        // Setup lighting
        this.setupLighting();

        // Setup fog
        this.setupFog();

        // Initialize network client
        this.networkClient = new NetworkClient(this.serverUrl);
        this.setupNetworkHandlers();

        // Initialize terrain renderer
        this.terrainRenderer = new TerrainRenderer(this.scene, this.networkClient);

        // Initialize vehicle renderer
        this.vehicleRenderer = new VehicleRenderer(this.scene, this.networkClient);

        // Initialize player controller
        this.playerController = new PlayerController(
            this.scene,
            this.camera,
            this.networkClient,
            this.terrainRenderer
        );

        // Setup UI
        this.setupUI();

        console.log('[Game] Initialization complete');
    }

    /**
     * Setup Three.js scene, camera, renderer
     */
    setupThreeJS() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            70,
            window.innerWidth / window.innerHeight,
            0.1,
            2000
        );
        this.camera.position.set(0, 10, 10);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        document.body.appendChild(this.renderer.domElement);

        // Handle resize
        window.addEventListener('resize', () => this.onResize());
    }

    /**
     * Setup scene lighting
     */
    setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambient);

        // Hemisphere light
        const hemisphere = new THREE.HemisphereLight(0x87ceeb, 0x444422, 0.6);
        this.scene.add(hemisphere);

        // Directional light (sun)
        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(100, 200, 100);
        directional.castShadow = true;
        directional.shadow.mapSize.width = 2048;
        directional.shadow.mapSize.height = 2048;
        directional.shadow.camera.near = 10;
        directional.shadow.camera.far = 500;
        directional.shadow.camera.left = -100;
        directional.shadow.camera.right = 100;
        directional.shadow.camera.top = 100;
        directional.shadow.camera.bottom = -100;
        this.scene.add(directional);
        this.directionalLight = directional;
    }

    /**
     * Setup fog
     */
    setupFog() {
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 500);
    }

    /**
     * Setup network event handlers
     */
    setupNetworkHandlers() {
        const nc = this.networkClient;

        nc.on('connected', (data) => {
            console.log('[Game] Connected to server:', data.clientId);
            this.hideLoadingScreen();
        });

        nc.on('disconnected', () => {
            console.log('[Game] Disconnected from server');
            this.showLoadingScreen('Disconnected. Reconnecting...');
            // Attempt reconnect
            setTimeout(() => {
                this.connect();
            }, CONFIG.network.reconnectDelay);
        });

        nc.on('entitySpawn', (data) => {
            this.handleEntitySpawn(data);
        });

        nc.on('entityDestroy', (data) => {
            this.handleEntityDestroy(data);
        });

        nc.on('worldSnapshot', (data) => {
            this.handleWorldSnapshot(data);
        });

        nc.on('vehicleEnter', (data) => {
            this.handleVehicleEnter(data);
        });

        nc.on('vehicleExit', (data) => {
            this.handleVehicleExit(data);
        });

        nc.on('chunkData', (data) => {
            this.terrainRenderer.handleChunkData(data);
        });

        nc.on('chatMessage', (data) => {
            this.handleChatMessage(data);
        });

        nc.on('latencyUpdate', (latency) => {
            this.updateLatencyDisplay(latency);
        });
    }

    /**
     * Handle entity spawn
     */
    handleEntitySpawn(data) {
        if (data.entityType === CONFIG.entityTypes.PLAYER) {
            if (data.isLocal) {
                // Local player spawned
                this.playerController.initPlayer(
                    data.entityId,
                    this.networkClient.clientId,
                    data.position,
                    data.appearance
                );
            } else {
                // Other player spawned
                this.playerController.spawnOtherPlayer(data.entityId, data);
            }
        } else if (data.entityType === CONFIG.entityTypes.VEHICLE) {
            this.vehicleRenderer.spawnVehicle(
                data.entityId,
                data.vehicleType,
                data.position,
                data.rotation
            );
        }
    }

    /**
     * Handle entity destroy
     */
    handleEntityDestroy(data) {
        if (data.entityId.startsWith('player_')) {
            this.playerController.removeOtherPlayer(data.entityId);
        } else if (data.entityId.startsWith('vehicle_')) {
            this.vehicleRenderer.removeVehicle(data.entityId);
        }
    }

    /**
     * Handle world snapshot
     */
    handleWorldSnapshot(data) {
        // Update players
        for (const playerState of data.players) {
            this.playerController.updateFromServer(playerState);
        }

        // Update vehicles
        for (const vehicleState of data.vehicles) {
            this.vehicleRenderer.updateVehicleState(vehicleState);
        }
    }

    /**
     * Handle vehicle enter
     */
    handleVehicleEnter(data) {
        if (data.playerId === this.networkClient.clientId) {
            // Local player entered vehicle
            this.playerController.inVehicle = true;
            this.playerController.vehicleId = data.vehicleId;
            this.vehicleRenderer.setLocalVehicle(data.vehicleId);

            // Hide player mesh
            if (this.playerController.characterGroup) {
                this.playerController.characterGroup.visible = false;
            }
        }
    }

    /**
     * Handle vehicle exit
     */
    handleVehicleExit(data) {
        if (data.playerId === this.networkClient.clientId) {
            // Local player exited vehicle
            this.playerController.inVehicle = false;
            this.playerController.vehicleId = null;
            this.vehicleRenderer.clearLocalVehicle();

            // Show player mesh
            if (this.playerController.characterGroup) {
                this.playerController.characterGroup.visible = true;
            }

            // Update position
            if (data.exitPosition) {
                this.playerController.predictedPosition.set(
                    data.exitPosition.x,
                    data.exitPosition.y,
                    data.exitPosition.z
                );
            }
        }
    }

    /**
     * Handle chat message
     */
    handleChatMessage(data) {
        console.log(`[Chat] ${data.username}: ${data.message}`);
        // Would add to chat UI here
    }

    /**
     * Setup UI elements
     */
    setupUI() {
        // Use existing UI elements (retro character designer + HUD)
        this.loadingScreen = document.getElementById('loading-screen');
        if (!this.loadingScreen) {
            this.loadingScreen = document.createElement('div');
            this.loadingScreen.id = 'loading-screen';
            this.loadingScreen.innerHTML = `
                <div class="loading-content">
                    <h1>CYBERIA 2000</h1>
                    <p class="loading-text">Connecting to server...</p>
                    <div class="loading-bar"><div class="loading-fill"></div></div>
                </div>
            `;
            this.loadingScreen.style.cssText = `
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 2000;
                color: #00ff88;
                font-family: 'Courier New', monospace;
            `;
            document.body.appendChild(this.loadingScreen);
        }

        this.gameUI = document.getElementById('game-ui');
        this.latencyEl = document.getElementById('latency') || document.createElement('div');
        this.positionEl = document.getElementById('hud-coords');
        this.healthFill = document.getElementById('hud-health-fill');
        this.staminaFill = document.getElementById('hud-stamina-fill');
    }

    /**
     * Show loading screen
     */
    showLoadingScreen(message = 'Connecting to server...') {
        this.loadingScreen.querySelector('.loading-text').textContent = message;
        this.loadingScreen.style.display = 'flex';
        this.gameUI.style.display = 'none';
    }

    /**
     * Hide loading screen
     */
    hideLoadingScreen() {
        this.loadingScreen.style.display = 'none';
        this.gameUI.style.display = 'block';
    }

    /**
     * Update latency display
     */
    updateLatencyDisplay(latency) {
        const el = document.getElementById('latency');
        if (el) {
            el.textContent = `Ping: ${Math.round(latency)}ms`;
        }
    }

    /**
     * Update position display
     */
    updatePositionDisplay(position) {
        if (this.positionEl) {
            this.positionEl.textContent = `Coords: ${Math.round(position.x)}, ${Math.round(position.y)}, ${Math.round(position.z)}`;
        }
    }

    /**
     * Update HUD
     */
    updateHUD() {
        const state = this.playerController.getState();

        if (this.healthFill) {
            this.healthFill.style.width = `${state.health}%`;
        }

        if (this.staminaFill) {
            this.staminaFill.style.width = `${(state.stamina / CONFIG.movement.maxStamina) * 100}%`;
        }

        this.updatePositionDisplay(state.position);
    }

    /**
     * Connect to server
     */
    connect() {
        this.showLoadingScreen('Connecting to server...');
        this.networkClient.connect(this.username, this.appearance);
    }

    /**
     * Start the game loop
     */
    start() {
        this.isRunning = true;
        this.lastFrameTime = performance.now();
        this.gameLoop();
    }

    /**
     * Stop the game loop
     */
    stop() {
        this.isRunning = false;
    }

    /**
     * Main game loop
     */
    gameLoop() {
        if (!this.isRunning) return;

        requestAnimationFrame(() => this.gameLoop());

        const now = performance.now();
        const deltaTime = Math.min((now - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = now;

        this.update(deltaTime);
        this.render();
    }

    /**
     * Update game state
     */
    update(deltaTime) {
        // Update player controller
        this.playerController.update(deltaTime);

        // Update vehicle renderer (handles remote smoothing and local control)
        this.vehicleRenderer.update(deltaTime);

        // Update terrain based on player position
        const playerPos = this.playerController.getPosition();
        this.terrainRenderer.update(playerPos);

        // Update directional light to follow player
        if (this.directionalLight && playerPos) {
            this.directionalLight.position.set(
                playerPos.x + 100,
                200,
                playerPos.z + 100
            );
            this.directionalLight.target.position.copy(playerPos);
        }

        // Update HUD
        this.updateHUD();
    }

    /**
     * Render the scene
     */
    render() {
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Handle window resize
     */
    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Cleanup
     */
    dispose() {
        this.stop();
        this.networkClient.disconnect();
        this.playerController.dispose();
        this.vehicleRenderer.dispose();
        this.terrainRenderer.dispose();
        this.renderer.dispose();
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.GameClient = GameClient;
}
