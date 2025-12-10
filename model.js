// Self-contained voxel-style character model and animation system used by character.html
// The module exposes a ModelRig class that builds the model and runs animations without
// relying on any other project files.

const {
    Group,
    Mesh,
    BoxGeometry,
    MeshStandardMaterial,
    CircleGeometry,
    Color,
    CanvasTexture
} = THREE;

const createFaceTexture = (skin = '#f7d8c2') => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, size, size);

    // Cheeks
    ctx.fillStyle = '#f1b4a4';
    ctx.beginPath();
    ctx.arc(20, 38, 6, 0, Math.PI * 2);
    ctx.arc(size - 20, 38, 6, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#0d0d0f';
    ctx.beginPath();
    ctx.arc(20, 28, 4, 0, Math.PI * 2);
    ctx.arc(size - 20, 28, 4, 0, Math.PI * 2);
    ctx.fill();

    // Nose
    ctx.strokeStyle = '#d48c78';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size * 0.48, 30);
    ctx.lineTo(size * 0.5, 36);
    ctx.stroke();

    // Mouth
    ctx.strokeStyle = '#b1545d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(24, 46);
    ctx.quadraticCurveTo(size / 2, 52, size - 24, 46);
    ctx.stroke();

    const tex = new CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
};

const MATERIALS = {
    skin: new MeshStandardMaterial({ color: new Color('#f7d8c2'), roughness: 0.55 }),
    face: new MeshStandardMaterial({ map: createFaceTexture(), roughness: 0.45 }),
    hair: new MeshStandardMaterial({ color: new Color('#c54f5c'), roughness: 0.35 }),
    jacket: new MeshStandardMaterial({ color: new Color('#121620'), roughness: 0.4, metalness: 0.1 }),
    jacketDetail: new MeshStandardMaterial({ color: new Color('#1b2538'), roughness: 0.42 }),
    shirt: new MeshStandardMaterial({ color: new Color('#a8202a'), roughness: 0.48 }),
    pants: new MeshStandardMaterial({ color: new Color('#243957'), roughness: 0.6 }),
    boots: new MeshStandardMaterial({ color: new Color('#0c0c0e'), roughness: 0.65 }),
    holster: new MeshStandardMaterial({ color: new Color('#0a0a0a'), roughness: 0.55 }),
    accent: new MeshStandardMaterial({ color: new Color('#0d1118'), roughness: 0.6, metalness: 0.12 }),
    emissive: new MeshStandardMaterial({ color: new Color('#1f4b99'), emissive: new Color('#163b7c'), emissiveIntensity: 0.4 })
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class ModelRig {
    constructor(options = {}) {
        this.options = options;
        this.group = new Group();
        this.meshGroup = new Group();
        this.group.add(this.meshGroup);

        this.limbs = {};
        this.bindPose = new Map();
        this.baseHipHeight = 0.9;
        this.animationState = 'idle';
        this.animationTime = 0;
        this.speedWeight = 0;
        this.jumpDuration = 1.15;

        this.buildModel();
    }

    buildModel() {
        const storeBindPose = (mesh) => {
            this.bindPose.set(mesh, {
                position: mesh.position.clone(),
                rotation: mesh.rotation.clone(),
                scale: mesh.scale.clone()
            });
        };
        const hipWidth = 0.42;
        const waistWidth = 0.3;
        const shoulderWidth = 0.38;

        const hips = new Mesh(new BoxGeometry(hipWidth, 0.22, 0.26), MATERIALS.pants);
        hips.position.y = this.baseHipHeight;
        this.meshGroup.add(hips);
        this.limbs.hips = hips;
        storeBindPose(hips);

        const midriff = new Mesh(new BoxGeometry(waistWidth, 0.13, 0.2), MATERIALS.skin);
        midriff.position.y = 0.17;
        hips.add(midriff);
        storeBindPose(midriff);

        const chestGroup = new Group();
        chestGroup.position.y = 0.12;
        midriff.add(chestGroup);
        this.limbs.spine = chestGroup;
        storeBindPose(chestGroup);

        const torsoWidth = shoulderWidth;
        const shirt = new Mesh(new BoxGeometry(torsoWidth, 0.34, 0.22), MATERIALS.shirt);
        shirt.position.y = 0.1;
        chestGroup.add(shirt);
        storeBindPose(shirt);

        const chestDetail = new Mesh(new BoxGeometry(0.28, 0.14, 0.08), MATERIALS.shirt);
        chestDetail.position.set(0, 0.1, -0.11);
        chestGroup.add(chestDetail);
        storeBindPose(chestDetail);

        const chestLeft = new Mesh(new BoxGeometry(0.12, 0.12, 0.06), MATERIALS.shirt);
        chestLeft.position.set(-0.07, 0.09, -0.13);
        chestGroup.add(chestLeft);
        storeBindPose(chestLeft);

        const chestRight = new Mesh(new BoxGeometry(0.12, 0.12, 0.06), MATERIALS.shirt);
        chestRight.position.set(0.07, 0.09, -0.13);
        chestGroup.add(chestRight);
        storeBindPose(chestRight);

        const jacketBack = new Mesh(new BoxGeometry(shoulderWidth + 0.04, 0.36, 0.06), MATERIALS.jacketDetail);
        jacketBack.position.set(0, 0.1, 0.12);
        chestGroup.add(jacketBack);
        storeBindPose(jacketBack);

        const jacketL = new Mesh(new BoxGeometry(0.08, 0.36, 0.26), MATERIALS.jacket);
        jacketL.position.set(shoulderWidth * 0.5 + 0.04, 0.1, 0);
        chestGroup.add(jacketL);
        storeBindPose(jacketL);

        const jacketR = new Mesh(new BoxGeometry(0.08, 0.36, 0.26), MATERIALS.jacket);
        jacketR.position.set(-shoulderWidth * 0.5 - 0.04, 0.1, 0);
        chestGroup.add(jacketR);
        storeBindPose(jacketR);

        const collar = new Mesh(new BoxGeometry(shoulderWidth + 0.08, 0.08, 0.26), MATERIALS.jacket);
        collar.position.set(0, 0.3, 0.04);
        chestGroup.add(collar);
        storeBindPose(collar);

        const neck = new Mesh(new BoxGeometry(0.12, 0.08, 0.12), MATERIALS.skin);
        neck.position.set(0, 0.32, 0.0);
        chestGroup.add(neck);
        storeBindPose(neck);

        const headMaterials = [MATERIALS.skin, MATERIALS.skin, MATERIALS.skin, MATERIALS.skin, MATERIALS.skin, MATERIALS.face];
        const head = new Mesh(new BoxGeometry(0.24, 0.28, 0.24), headMaterials);
        head.position.y = 0.45;
        chestGroup.add(head);
        this.limbs.head = head;
        storeBindPose(head);

        const hairGroup = new Group();
        head.add(hairGroup);
        storeBindPose(hairGroup);

        const hairCap = new Mesh(new BoxGeometry(0.26, 0.12, 0.26), MATERIALS.hair);
        hairCap.position.y = 0.15;
        hairGroup.add(hairCap);
        storeBindPose(hairCap);

        const hairBack = new Mesh(new BoxGeometry(0.28, 0.44, 0.08), MATERIALS.hair);
        hairBack.position.set(0, -0.1, 0.13);
        hairGroup.add(hairBack);
        storeBindPose(hairBack);

        const hairSideL = new Mesh(new BoxGeometry(0.08, 0.42, 0.2), MATERIALS.hair);
        hairSideL.position.set(0.14, -0.1, 0.02);
        hairGroup.add(hairSideL);
        storeBindPose(hairSideL);

        const hairSideR = new Mesh(new BoxGeometry(0.08, 0.42, 0.2), MATERIALS.hair);
        hairSideR.position.set(-0.14, -0.1, 0.02);
        hairGroup.add(hairSideR);
        storeBindPose(hairSideR);

        const bangs = new Mesh(new BoxGeometry(0.26, 0.12, 0.05), MATERIALS.hair);
        bangs.position.set(0, 0.08, -0.13);
        hairGroup.add(bangs);
        storeBindPose(bangs);

        const legWidth = 0.15;
        const legGeo = new BoxGeometry(legWidth, 0.85, 0.17);
        const leftLeg = new Mesh(legGeo, MATERIALS.pants);
        leftLeg.position.set(hipWidth * 0.3, -0.45, 0);
        hips.add(leftLeg);
        this.limbs.leftLeg = leftLeg;
        storeBindPose(leftLeg);

        const holsterL = new Mesh(new BoxGeometry(0.07, 0.24, 0.2), MATERIALS.holster);
        holsterL.position.set(0.06, 0.1, 0.01);
        leftLeg.add(holsterL);
        storeBindPose(holsterL);

        const strapL = new Mesh(new BoxGeometry(0.15, 0.05, 0.16), MATERIALS.holster);
        strapL.position.set(0, 0.1, 0.01);
        leftLeg.add(strapL);
        storeBindPose(strapL);

        const rightLeg = new Mesh(legGeo, MATERIALS.pants);
        rightLeg.position.set(-hipWidth * 0.3, -0.45, 0);
        hips.add(rightLeg);
        this.limbs.rightLeg = rightLeg;
        storeBindPose(rightLeg);

        const holsterR = new Mesh(new BoxGeometry(0.07, 0.24, 0.2), MATERIALS.holster);
        holsterR.position.set(-0.06, 0.1, 0.01);
        rightLeg.add(holsterR);
        storeBindPose(holsterR);

        const strapR = new Mesh(new BoxGeometry(0.15, 0.05, 0.16), MATERIALS.holster);
        strapR.position.set(0, 0.1, 0.01);
        rightLeg.add(strapR);
        storeBindPose(strapR);

        const bootGeo = new BoxGeometry(0.18, 0.25, 0.25);
        const leftBoot = new Mesh(bootGeo, MATERIALS.boots);
        leftBoot.position.set(0, -0.35, -0.04);
        leftLeg.add(leftBoot);
        storeBindPose(leftBoot);

        const rightBoot = new Mesh(bootGeo, MATERIALS.boots);
        rightBoot.position.set(0, -0.35, -0.04);
        rightLeg.add(rightBoot);
        storeBindPose(rightBoot);

        const armGeo = new BoxGeometry(0.11, 0.7, 0.11);
        const leftArm = new Mesh(armGeo, MATERIALS.jacket);
        leftArm.position.set(shoulderWidth * 0.5 + 0.06, -0.05, 0);
        chestGroup.add(leftArm);
        this.limbs.leftArm = leftArm;
        storeBindPose(leftArm);

        const leftGlove = new Mesh(new BoxGeometry(0.12, 0.15, 0.12), MATERIALS.holster);
        leftGlove.position.y = -0.3;
        leftArm.add(leftGlove);
        this.limbs.leftHand = leftGlove;
        storeBindPose(leftGlove);

        const rightArm = new Mesh(armGeo, MATERIALS.jacket);
        rightArm.position.set(-shoulderWidth * 0.5 - 0.06, -0.05, 0);
        chestGroup.add(rightArm);
        this.limbs.rightArm = rightArm;
        storeBindPose(rightArm);

        const rightGlove = new Mesh(new BoxGeometry(0.12, 0.15, 0.12), MATERIALS.holster);
        rightGlove.position.y = -0.3;
        rightArm.add(rightGlove);
        this.limbs.rightHand = rightGlove;
        storeBindPose(rightGlove);

        const belt = new Mesh(new BoxGeometry(0.46, 0.06, 0.18), MATERIALS.holster);
        belt.position.set(0, 0.02, 0.06);
        hips.add(belt);
        storeBindPose(belt);

        const band = new Mesh(new BoxGeometry(0.5, 0.06, 0.14), MATERIALS.emissive);
        band.position.set(0, -0.02, 0.13);
        chestGroup.add(band);
        storeBindPose(band);

        const backSigil = new Mesh(new BoxGeometry(0.22, 0.24, 0.015), MATERIALS.emissive);
        backSigil.position.set(0, 0.08, 0.16);
        chestGroup.add(backSigil);
        storeBindPose(backSigil);

        const shadow = new Mesh(new CircleGeometry(0.55, 12), MATERIALS.accent.clone());
        shadow.material.transparent = true;
        shadow.material.opacity = 0.35;
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = -0.92;
        this.meshGroup.add(shadow);
        storeBindPose(shadow);
    }

    get animationList() {
        return Object.keys(ANIMATIONS);
    }

    setAnimation(state) {
        if (!ANIMATIONS[state]) return;
        if (this.animationState !== state) {
            this.animationState = state;
            this.animationTime = 0;
        }
    }

    resetPose() {
        for (const limb of Object.values(this.limbs)) {
            const bind = this.bindPose.get(limb);
            if (bind) {
                limb.rotation.copy(bind.rotation);
                limb.position.copy(bind.position);
                limb.scale.copy(bind.scale);
            }
        }
        this.meshGroup.position.set(0, 0, 0);
        this.limbs.hips.position.y = this.baseHipHeight;
    }

    updateAnimation(delta = 0.016, speed = 0) {
        this.animationTime += delta;
        this.resetPose();
        const anim = ANIMATIONS[this.animationState] || ANIMATIONS.idle;
        const context = {
            rig: this,
            limbs: this.limbs,
            speed,
            t: this.animationTime,
            delta,
            speedWeight: clamp(speed / 12, 0, 1)
        };
        anim(context);
    }
}

const ANIMATIONS = {
    idle: ({ limbs, t }) => {
        const sway = Math.sin(t * 0.8) * 0.04;
        const breathe = Math.sin(t * 1.1) * 0.015;
        limbs.hips.rotation.y = sway * 0.5;
        limbs.spine.rotation.y = -sway * 0.45;
        limbs.spine.position.y += breathe * 0.35;
        limbs.head.rotation.y = Math.sin(t * 0.6) * 0.07;
        limbs.head.rotation.x = Math.sin(t * 0.4) * 0.05;
        limbs.leftArm.rotation.x = -0.16 + breathe * 0.5;
        limbs.rightArm.rotation.x = -0.16 - breathe * 0.5;
    },

    breathe: ({ limbs, t }) => {
        const inhale = (Math.sin(t * 1.05 - Math.PI / 2) + 1) / 2;
        const chestLift = inhale * 0.018;
        const shoulderRoll = Math.sin(t * 0.55) * 0.08;
        limbs.spine.position.y += chestLift;
        limbs.spine.scale.y = 1 + inhale * 0.04;
        limbs.hips.rotation.y = shoulderRoll * 0.2;
        limbs.leftArm.rotation.x = -0.12 + inhale * 0.08;
        limbs.rightArm.rotation.x = -0.12 + inhale * 0.08;
        limbs.head.rotation.x = -inhale * 0.06;
        limbs.head.rotation.y = shoulderRoll * 0.35;
    },

    walk: ({ limbs, t, speedWeight }) => {
        const cadence = 4.4 + speedWeight * 1.2;
        const cycle = Math.sin(t * cadence);
        const lift = Math.abs(Math.cos(t * cadence)) * 0.04;
        limbs.leftLeg.rotation.x = cycle * 0.6;
        limbs.rightLeg.rotation.x = -cycle * 0.6;
        limbs.leftArm.rotation.x = -cycle * 0.45;
        limbs.rightArm.rotation.x = cycle * 0.45;
        limbs.hips.position.y += lift;
        limbs.hips.rotation.y = Math.sin(t * cadence * 0.5) * 0.08;
        limbs.spine.rotation.y = -limbs.hips.rotation.y * 0.8;
    },

    run: ({ limbs, t, speedWeight }) => {
        const cadence = 7 + speedWeight * 3;
        const cycle = Math.sin(t * cadence);
        const lift = Math.abs(Math.cos(t * cadence)) * 0.08;
        limbs.leftLeg.rotation.x = cycle * 1.0;
        limbs.rightLeg.rotation.x = -cycle * 1.0;
        limbs.leftArm.rotation.x = -cycle * 0.8;
        limbs.rightArm.rotation.x = cycle * 0.8;
        limbs.spine.rotation.x = Math.sin(t * cadence * 0.5) * 0.08;
        limbs.hips.position.y += lift;
        limbs.head.rotation.y = Math.sin(t * cadence * 0.4) * 0.05;
    },

    jump: ({ rig, limbs, t }) => {
        const progress = clamp(t / rig.jumpDuration, 0, 1);
        const rise = Math.sin(progress * Math.PI);
        const tuck = Math.sin(Math.min(progress, 0.6) * Math.PI) * 0.6;
        rig.meshGroup.position.y = rise * 0.65;
        limbs.leftLeg.rotation.x = 0.4 - tuck * 0.6;
        limbs.rightLeg.rotation.x = 0.4 - tuck * 0.6;
        limbs.leftArm.rotation.x = -0.35;
        limbs.rightArm.rotation.x = -0.35;
        limbs.spine.rotation.x = tuck * 0.15;
        if (progress >= 1) rig.setAnimation('idle');
    },

    wave: ({ limbs, t }) => {
        const wave = Math.sin(t * 5.4) * 0.7;
        limbs.leftArm.rotation.x = -0.2;
        limbs.rightArm.rotation.x = 0.1;
        limbs.rightArm.rotation.z = wave - 0.4;
        limbs.rightArm.rotation.y = Math.sin(t * 2.6) * 0.3;
        limbs.spine.rotation.y = Math.sin(t * 1.6) * 0.25;
        limbs.head.rotation.y = -limbs.spine.rotation.y * 0.4;
    },

    crouch: ({ limbs, t }) => {
        const settle = (Math.sin(t * 2) + 1) / 2;
        limbs.hips.position.y -= 0.35;
        limbs.leftLeg.rotation.x = -0.6;
        limbs.rightLeg.rotation.x = -0.6;
        limbs.leftLeg.rotation.y = 0.12;
        limbs.rightLeg.rotation.y = -0.12;
        limbs.leftArm.rotation.x = -0.2 - settle * 0.15;
        limbs.rightArm.rotation.x = -0.2 - settle * 0.15;
        limbs.spine.rotation.x = 0.25;
        limbs.head.rotation.x = -0.15;
    },

    stretch: ({ limbs, t }) => {
        const reach = (Math.sin(t * 1.4 - Math.PI / 2) + 1) / 2;
        limbs.leftArm.rotation.x = -Math.PI / 2 + reach * 0.3;
        limbs.rightArm.rotation.x = -Math.PI / 2 + reach * 0.3;
        limbs.spine.rotation.x = 0.18 * reach;
        limbs.spine.rotation.y = Math.sin(t * 0.8) * 0.12;
        limbs.head.rotation.x = -reach * 0.1;
        limbs.hips.position.y += reach * 0.04;
    },

    'look-around': ({ limbs, t }) => {
        const sweep = Math.sin(t * 0.9) * 0.6;
        limbs.head.rotation.y = sweep;
        limbs.head.rotation.x = Math.sin(t * 0.7) * 0.15;
        limbs.spine.rotation.y = sweep * 0.4;
        limbs.leftArm.rotation.x = -0.18;
        limbs.rightArm.rotation.x = -0.18;
    },

    'combat-idle': ({ limbs, t }) => {
        const bounce = Math.sin(t * 4) * 0.02;
        limbs.hips.position.y += bounce;
        limbs.leftLeg.rotation.x = 0.1;
        limbs.rightLeg.rotation.x = -0.1;
        limbs.leftArm.rotation.x = -0.3;
        limbs.rightArm.rotation.x = -0.45;
        limbs.rightArm.rotation.z = -0.25;
        limbs.spine.rotation.y = Math.sin(t * 1.6) * 0.1;
        limbs.head.rotation.y = limbs.spine.rotation.y * 0.6;
    }
};
