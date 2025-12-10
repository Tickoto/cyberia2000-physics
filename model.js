// Self-contained voxel-style character model and animation system used by character.html
// The module exposes a ModelRig class that builds the model and runs animations without
// relying on any other project files.

const { Group, Mesh, BoxGeometry, MeshStandardMaterial, CircleGeometry, Color } = THREE;

const MATERIALS = {
    skin: new MeshStandardMaterial({ color: new Color('#f2d3b4'), roughness: 0.6 }),
    hair: new MeshStandardMaterial({ color: new Color('#c14a52'), roughness: 0.4 }),
    jacket: new MeshStandardMaterial({ color: new Color('#1a1f2a'), roughness: 0.45, metalness: 0.05 }),
    shirt: new MeshStandardMaterial({ color: new Color('#b52d2d'), roughness: 0.5 }),
    pants: new MeshStandardMaterial({ color: new Color('#223d66'), roughness: 0.65 }),
    boots: new MeshStandardMaterial({ color: new Color('#0d0d0f'), roughness: 0.7 }),
    accent: new MeshStandardMaterial({ color: new Color('#0d1118'), roughness: 0.6, metalness: 0.08 }),
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

        const hips = new Mesh(new BoxGeometry(0.42, 0.22, 0.28), MATERIALS.pants);
        hips.position.y = this.baseHipHeight;
        this.meshGroup.add(hips);
        this.limbs.hips = hips;
        storeBindPose(hips);

        const midriff = new Mesh(new BoxGeometry(0.30, 0.14, 0.22), MATERIALS.skin);
        midriff.position.y = 0.18;
        hips.add(midriff);
        storeBindPose(midriff);

        const spine = new Group();
        spine.position.y = 0.12;
        midriff.add(spine);
        this.limbs.spine = spine;
        storeBindPose(spine);

        const chest = new Mesh(new BoxGeometry(0.38, 0.34, 0.24), MATERIALS.shirt);
        chest.position.y = 0.1;
        spine.add(chest);
        storeBindPose(chest);

        const jacket = new Mesh(new BoxGeometry(0.44, 0.38, 0.28), MATERIALS.jacket);
        jacket.position.set(0, 0.1, 0);
        spine.add(jacket);
        storeBindPose(jacket);

        const head = new Mesh(new BoxGeometry(0.26, 0.30, 0.26), MATERIALS.skin);
        head.position.y = 0.45;
        spine.add(head);
        this.limbs.head = head;
        storeBindPose(head);

        const hair = new Mesh(new BoxGeometry(0.28, 0.16, 0.28), MATERIALS.hair);
        hair.position.y = 0.16;
        head.add(hair);
        storeBindPose(hair);

        const bangs = new Mesh(new BoxGeometry(0.26, 0.12, 0.05), MATERIALS.hair);
        bangs.position.set(0, 0.06, -0.15);
        head.add(bangs);
        storeBindPose(bangs);

        const ponytail = new Mesh(new BoxGeometry(0.12, 0.34, 0.12), MATERIALS.hair);
        ponytail.position.set(0, -0.06, 0.18);
        head.add(ponytail);
        storeBindPose(ponytail);

        const legGeo = new BoxGeometry(0.16, 0.86, 0.18);
        const leftLeg = new Mesh(legGeo, MATERIALS.pants);
        leftLeg.position.set(0.14, -0.45, 0);
        hips.add(leftLeg);
        this.limbs.leftLeg = leftLeg;
        storeBindPose(leftLeg);

        const rightLeg = new Mesh(legGeo, MATERIALS.pants);
        rightLeg.position.set(-0.14, -0.45, 0);
        hips.add(rightLeg);
        this.limbs.rightLeg = rightLeg;
        storeBindPose(rightLeg);

        const bootGeo = new BoxGeometry(0.18, 0.24, 0.26);
        const leftBoot = new Mesh(bootGeo, MATERIALS.boots);
        leftBoot.position.set(0, -0.38, -0.02);
        leftLeg.add(leftBoot);
        storeBindPose(leftBoot);
        const rightBoot = new Mesh(bootGeo, MATERIALS.boots);
        rightBoot.position.set(0, -0.38, -0.02);
        rightLeg.add(rightBoot);
        storeBindPose(rightBoot);

        const shoulderOffset = 0.26;
        const armGeo = new BoxGeometry(0.12, 0.72, 0.12);
        const leftArm = new Mesh(armGeo, MATERIALS.jacket);
        leftArm.position.set(shoulderOffset, 0.0, 0);
        spine.add(leftArm);
        this.limbs.leftArm = leftArm;
        storeBindPose(leftArm);

        const rightArm = new Mesh(armGeo, MATERIALS.jacket);
        rightArm.position.set(-shoulderOffset, 0.0, 0);
        spine.add(rightArm);
        this.limbs.rightArm = rightArm;
        storeBindPose(rightArm);

        const gloveGeo = new BoxGeometry(0.13, 0.15, 0.13);
        const leftHand = new Mesh(gloveGeo, MATERIALS.accent);
        leftHand.position.y = -0.32;
        leftArm.add(leftHand);
        this.limbs.leftHand = leftHand;
        storeBindPose(leftHand);

        const rightHand = new Mesh(gloveGeo, MATERIALS.accent);
        rightHand.position.y = -0.32;
        rightArm.add(rightHand);
        this.limbs.rightHand = rightHand;
        storeBindPose(rightHand);

        const band = new Mesh(new BoxGeometry(0.5, 0.06, 0.14), MATERIALS.emissive);
        band.position.set(0, -0.02, 0.13);
        spine.add(band);
        storeBindPose(band);

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
        const sway = Math.sin(t * 0.8) * 0.05;
        const breathe = Math.sin(t * 1.2) * 0.02;
        limbs.hips.rotation.y = sway * 0.5;
        limbs.spine.rotation.y = -sway * 0.4;
        limbs.spine.position.y += breathe * 0.5;
        limbs.head.rotation.y = Math.sin(t * 0.6) * 0.08;
        limbs.head.rotation.x = Math.sin(t * 0.4) * 0.05;
        limbs.leftArm.rotation.x = -0.12 + breathe * 0.8;
        limbs.rightArm.rotation.x = -0.12 - breathe * 0.8;
    },

    breathe: ({ limbs, t }) => {
        const inhale = (Math.sin(t * 1.1 - Math.PI / 2) + 1) / 2;
        const chestLift = inhale * 0.025;
        const shoulderRoll = Math.sin(t * 0.6) * 0.08;
        limbs.spine.position.y += chestLift;
        limbs.spine.scale.y = 1 + inhale * 0.03;
        limbs.hips.rotation.y = shoulderRoll * 0.25;
        limbs.leftArm.rotation.x = -0.1 + inhale * 0.1;
        limbs.rightArm.rotation.x = -0.1 + inhale * 0.1;
        limbs.head.rotation.x = -inhale * 0.05;
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
