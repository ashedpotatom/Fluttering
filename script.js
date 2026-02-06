// Matter.js modules
const { Engine, Render, World, Bodies, Constraint, Mouse, MouseConstraint, Body, Composite } = Matter;

// Configuration
const TEXT_AREA_PADDING = 0.1;
const ROPE_Y = 100;
const STIFFNESS = 0.005; // Lowered significantly for "rope/fabric" feel
const DAMPING = 0.05;
const FRICTION_AIR = 0.06; // Slightly higher for "laundry" drag

// Physics Engine Setup
let engine, world;
let charBodies = [];
let charElements = [];
let constraints = [];
let ropeBodies = [];
let fallenBodies = [];
let fallenElements = [];

// Audio Setup
class SoundManager {
    constructor() {
        this.ctx = null;
        this.initialized = false;
        this.isMuted = false;
    }

    init() {
        if (this.initialized) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.initialized = true;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        const btn = document.getElementById('sound-toggle-btn');
        if (this.isMuted) {
            btn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="speaker-off">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                    <line x1="23" y1="9" x2="17" y2="15"></line>
                    <line x1="17" y1="9" x2="23" y2="15"></line>
                </svg>`;
        } else {
            btn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="speaker-on">
                    <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>`;
        }
    }

    playCollision(intensity, size = 100) {
        if (!this.initialized || this.isMuted || intensity < 0.2) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Adjust pitch based on size: larger = lower, smaller = higher
        // size typical range is around 50 to 200 based on font size logic
        osc.type = 'triangle';
        const baseFreq = Math.max(200, 1200 - (size * 5)) + (Math.random() * 100);

        osc.frequency.setValueAtTime(baseFreq, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, this.ctx.currentTime + 0.1);

        // Volume scaled by intensity: higher intensity = louder sound
        // Base vol range is roughly 0.01 (min) to 0.15 (max) before 30% reduction
        const baseVol = Math.min(Math.max(intensity * 0.1, 0.02), 0.15);
        const vol = baseVol * 0.7; // Apply 30% reduction requested earlier
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }
}

const sounds = new SoundManager();

// Initialize Physics Engine
function initEngine() {
    engine = Engine.create();
    world = engine.world;
    world.gravity.y = 1.2; // Slightly stronger gravity for faster fall
    window.prevWidth = window.innerWidth;

    // Create Boundaries (Floor and Walls)
    createBoundaries();

    // Start simulation
    const runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);

    // Collision sounds
    Matter.Events.on(engine, 'collisionStart', (event) => {
        event.pairs.forEach(pair => {
            const bodyA = pair.bodyA;
            const bodyB = pair.bodyB;

            // Only play sound if one of the bodies is a letter
            const isALetter = charBodies.includes(bodyA) || fallenBodies.includes(bodyA);
            const isBLetter = charBodies.includes(bodyB) || fallenBodies.includes(bodyB);

            if (isALetter || isBLetter) {
                const speed = Math.sqrt(
                    Math.pow(bodyA.velocity.x - bodyB.velocity.x, 2) +
                    Math.pow(bodyA.velocity.y - bodyB.velocity.y, 2)
                );

                // Calculate size for pitch adjustment
                // Use the average width of the colliding bodies if they are characters
                let collisionSize = 100;
                const widthA = bodyA.bounds.max.x - bodyA.bounds.min.x;
                const widthB = bodyB.bounds.max.x - bodyB.bounds.min.x;

                if (isALetter && isBLetter) {
                    collisionSize = (widthA + widthB) / 2;
                } else if (isALetter) {
                    collisionSize = widthA;
                } else {
                    collisionSize = widthB;
                }

                sounds.playCollision(speed, collisionSize);
            }
        });
    });
}

// Create screen boundaries
function createBoundaries() {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Robust floor (extra thick to prevent tunneling)
    const floor = Bodies.rectangle(screenWidth / 2, screenHeight + 250, screenWidth * 5, 500, {
        isStatic: true,
        render: { visible: false }
    });

    const leftWall = Bodies.rectangle(-50, screenHeight / 2, 100, screenHeight * 2, {
        isStatic: true,
        render: { visible: false }
    });

    const rightWall = Bodies.rectangle(screenWidth + 50, screenHeight / 2, 100, screenHeight * 2, {
        isStatic: true,
        render: { visible: false }
    });

    World.add(world, [floor, leftWall, rightWall]);
}

// Precise character measurement using hidden canvas
const measurementCanvas = document.createElement('canvas');
const measurementContext = measurementCanvas.getContext('2d');

function getCharWidth(char, fontSize, spacingRatio = 0) {
    const isKorean = /[\u3131-\uD79D]/.test(char);
    const fontFamily = isKorean ? 'Noto Sans KR' : 'Gloock';
    measurementContext.font = `900 ${fontSize}px ${fontFamily}`;

    // Canvas measureText is very accurate. 
    // Dynamic letter spacing ratio applied to English characters.
    const baseWidth = measurementContext.measureText(char).width;
    const letterSpacing = isKorean ? 0 : fontSize * spacingRatio;
    return Math.ceil(baseWidth + letterSpacing) + 1;
}

// Split text into lines based on width
function calculateLines(chars, fontSize, maxWidth, spacingRatio) {
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    chars.forEach(char => {
        const charWidth = getCharWidth(char, fontSize, spacingRatio);
        if (currentWidth + charWidth > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = [char];
            currentWidth = charWidth;
        } else {
            currentLine.push(char);
            currentWidth += charWidth;
        }
    });

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
}

// Create hanging text
function createHangingText(text) {
    clearCharacters();

    const chars = Array.from(text);
    if (chars.length === 0) return;

    const container = document.getElementById('text-container');
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Mobile base: 15.38 * 1.2 = 18.46vw. Desktop min: 9.04vw.
    // Increased by 40%: 18.46 * 1.4 = 25.84
    // Reduced by 10% as per user request: 25.84 * 0.9 = 23.256
    const reductionFactor = Math.max(0.49, 1 - Math.max(0, screenWidth - 600) / 1400 * 0.51);
    const baseFontSizeVw = 23.256 * reductionFactor;

    // Dynamic spacing ratio: 0.072em (MO) -> 0.084em (PC)
    const spacingRatio = 0.072 + Math.max(0, screenWidth - 600) / 1400 * 0.012;

    // Shrink text as it gets longer. Start shrinking after 1st character.
    const lengthFactor = 1 / (1 + Math.max(0, chars.length - 1) * 0.04);
    let fontSizeVw = Math.max(baseFontSizeVw * lengthFactor, 3.15); // Reduced by 30% from 4.5

    // Reduce size by 10% specifically on mobile
    if (screenWidth < 768) {
        fontSizeVw *= 0.9;
    }
    const fontSize = (fontSizeVw * screenWidth) / 100; // Convert to pixels for physics internal calc

    const charHeight = fontSize * 0.85; // Tighter height for better stacking
    const textAreaPadding = screenWidth * TEXT_AREA_PADDING;
    const textAreaWidth = screenWidth - (textAreaPadding * 2);
    const lineHeight = charHeight + 65; // Reduced from 110

    const lines = calculateLines(chars, fontSize, textAreaWidth, spacingRatio);
    const totalHeight = lines.length * lineHeight;
    const startY = Math.max(ROPE_Y + charHeight + 10, (screenHeight - totalHeight) / 3.5);

    lines.forEach((lineChars, lineIndex) => {
        const totalLineWidth = lineChars.reduce((sum, char) => sum + getCharWidth(char, fontSize, spacingRatio), 0);
        let currentX = (screenWidth - totalLineWidth) / 2;
        const ropeY = startY + lineIndex * lineHeight - 35;

        const ropeBody = Bodies.rectangle(screenWidth / 2, ropeY, screenWidth, 10, {
            isStatic: true,
            render: { visible: false }
        });
        World.add(world, ropeBody);
        ropeBodies.push(ropeBody);

        lineChars.forEach((char) => {
            const charWidth = getCharWidth(char, fontSize, spacingRatio);
            const x = currentX + charWidth / 2;
            const y = ropeY + charHeight + 35;

            currentX += charWidth;

            const span = document.createElement('span');
            const isKorean = /[\u3131-\uD79D]/.test(char);
            span.className = `char-span ${isKorean ? 'char-ko' : 'char-en'}`;
            span.textContent = char;
            span.style.fontSize = `${fontSizeVw}vw`;
            span.style.letterSpacing = isKorean ? '0' : `${spacingRatio}em`;
            span.style.direction = 'ltr';
            span.style.unicodeBidi = 'plaintext';
            span.style.color = '#0065FF';

            container.appendChild(span);
            charElements.push(span);

            // Dynamic Density: Smaller characters get higher density to feel "heavier" and resist wind
            const baseDensity = 0.001;
            const densityMultiplier = Math.pow(134 / fontSize, 1.5);
            const density = baseDensity * densityMultiplier;

            const body = Bodies.rectangle(x, y, charWidth, charHeight, {
                frictionAir: FRICTION_AIR,
                friction: 0.1,
                restitution: 0.2,
                density: density,
                render: { visible: false }
            });
            World.add(world, body);
            charBodies.push(body);

            const constraint = Constraint.create({
                bodyA: ropeBody,
                pointA: { x: x - screenWidth / 2, y: 5 },
                bodyB: body,
                pointB: { x: 0, y: -charHeight / 2 },
                stiffness: STIFFNESS,
                damping: DAMPING,
                length: 35, // Reduced from 50
                render: { visible: false }
            });
            World.add(world, constraint);
            constraints.push(constraint);
        });
    });

    charBodies.forEach(body => {
        const shakeForce = 0.015;
        const randomTorque = (Math.random() - 0.5) * 0.12;

        Body.setAngularVelocity(body, randomTorque);
        Body.applyForce(body, body.position, {
            x: (Math.random() - 0.5) * shakeForce,
            y: (Math.random() - 0.5) * shakeForce
        });
    });
}

// Clear currently hanging text
function clearCharacters() {
    charBodies.forEach(body => World.remove(world, body));
    constraints.forEach(c => World.remove(world, c));
    ropeBodies.forEach(b => World.remove(world, b));
    charElements.forEach(el => el.remove());

    charBodies = [];
    charElements = [];
    constraints = [];
    ropeBodies = [];
}

// Delete all (including fallen) with a flutter animation
function deleteWithFlutter() {
    const allBodies = [...charBodies];
    const allElements = [...charElements];
    const allConstraints = [...constraints];

    // Remove constraints to let them fall
    allConstraints.forEach(c => World.remove(world, c));
    constraints = [];

    // Remove rope bodies (they are invisible anchors)
    ropeBodies.forEach(b => World.remove(world, b));
    ropeBodies = [];

    // Add hanging bodies to fallen category so they persist on floor
    fallenBodies.push(...charBodies);
    fallenElements.push(...charElements);

    // Clear hanging lists
    charBodies = [];
    charElements = [];

    // Apply a slight upward/sideways flutter and rotation to all bodies falling from the rope
    allBodies.forEach((body) => {
        body.frictionAir = 0.005; // Dramatically lower friction for fast, chaotic tumble
        const randomX = (Math.random() - 0.5) * 0.01; // Reduced horizontal scatter
        const randomY = -0.005 - Math.random() * 0.003; // Significantly more subtle upward pop
        const randomTorque = (Math.random() - 0.5) * 0.35; // Slightly reduced rotation to match subtler forces

        Body.setAngularVelocity(body, randomTorque);
        Body.applyForce(body, body.position, { x: randomX, y: randomY });
    });
}

// Sync DOM with Physics Engine
function animate() {
    charBodies.forEach((body, i) => {
        const el = charElements[i];
        if (el) {
            el.style.transform = `translate(${body.position.x - el.offsetWidth / 2}px, ${body.position.y - el.offsetHeight / 2}px) rotate(${body.angle}rad)`;
        }
    });

    fallenBodies.forEach((body, i) => {
        const el = fallenElements[i];
        if (el) {
            el.style.transform = `translate(${body.position.x - el.offsetWidth / 2}px, ${body.position.y - el.offsetHeight / 2}px) rotate(${body.angle}rad)`;
        }
    });

    requestAnimationFrame(animate);
}

// Handle resizing
function handleResize() {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const oldCenter = (window.prevWidth || screenWidth) / 2;
    const newCenter = screenWidth / 2;

    // Calculate scale factor for bodies
    const scaleFactor = screenWidth / window.prevWidth;

    World.clear(world, true);
    createBoundaries();

    charBodies.forEach((body, i) => {
        const offset = (body.position.x - oldCenter) * scaleFactor;
        Body.setPosition(body, { x: newCenter + offset, y: body.position.y * scaleFactor });
        Body.scale(body, scaleFactor, scaleFactor);
        World.add(world, body);
    });

    ropeBodies.forEach(body => {
        Body.setPosition(body, { x: newCenter, y: body.position.y * scaleFactor });
        Body.scale(body, scaleFactor, 1);
        World.add(world, body);
    });

    constraints.forEach(c => World.add(world, c));

    fallenBodies.forEach(body => {
        const offset = (body.position.x - oldCenter) * scaleFactor;
        let newX = newCenter + offset;
        let newY = body.position.y * scaleFactor;

        if (newY > screenHeight - 20) {
            newY = screenHeight - 20;
        }

        Body.setPosition(body, { x: newX, y: newY });
        Body.scale(body, scaleFactor, scaleFactor);
        World.add(world, body);
    });

    window.prevWidth = screenWidth;
}

const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

function initMouse() {
    const container = document.getElementById('text-container');
    const mouse = Mouse.create(container);
    const mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.2,
            render: { visible: false }
        }
    });
    World.add(world, mouseConstraint);
}

function init() {
    initEngine();
    initMouse();
    animate();

    const resumeAudio = () => {
        sounds.init();
        document.removeEventListener('mousedown', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
        document.removeEventListener('touchstart', resumeAudio);
    };
    document.addEventListener('mousedown', resumeAudio);
    document.addEventListener('keydown', resumeAudio);
    document.addEventListener('touchstart', resumeAudio);

    const input = document.getElementById('text-input');
    const resetBtn = document.getElementById('reset-btn');
    const submitBtn = document.getElementById('submit-btn');
    const fullResetBtn = document.getElementById('full-reset-btn');

    const handleInput = () => {
        input.style.height = 'auto';
        const newHeight = Math.min(input.scrollHeight, 200);
        input.style.height = newHeight + 'px';
        input.style.overflowY = input.scrollHeight > 200 ? 'auto' : 'hidden';
    };

    const handleSubmit = () => {
        const text = input.value.trim();
        if (text) {
            createHangingText(text);
            input.value = '';
            input.style.height = 'auto';
            input.style.overflowY = 'hidden';
        }
    };

    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            handleSubmit();
        }
    });

    submitBtn.addEventListener('click', handleSubmit);
    resetBtn.addEventListener('click', deleteWithFlutter);

    document.getElementById('sound-toggle-btn').addEventListener('click', () => {
        sounds.toggleMute();
    });

    fullResetBtn.addEventListener('click', () => {
        // Clear everything
        clearCharacters();
        fallenBodies.forEach(body => World.remove(world, body));
        fallenElements.forEach(el => el.remove());
        fallenBodies = [];
        fallenElements = [];

        // Return to initial state
        createHangingText('Laundry');
    });
    window.addEventListener('resize', debounce(handleResize, 20));
    input.focus();

    createHangingText('Laundry');
    scheduleNextWind();
}

function scheduleNextWind() {
    // Fixed gap between wind bursts: 1s
    const gap = 1000;

    setTimeout(() => {
        applyWindEffect(() => {
            scheduleNextWind();
        });
    }, gap);
}

function applyWindEffect(onComplete) {
    const bodies = [...charBodies, ...fallenBodies];
    if (bodies.length === 0) {
        if (onComplete) onComplete();
        return;
    }

    // Random duration between 0.7s and 3s
    const durationMs = 700 + Math.random() * 2300;
    const totalFrames = Math.floor(durationMs / 16.66); // approx 60fps

    let frames = 0;
    const baseForceX = 0.00245;
    const direction = Math.random() > 0.5 ? 1 : -1;
    const randomMultiplier = 0.5 + Math.random() * 1.0;
    const forceX = baseForceX * randomMultiplier * direction;

    const windAnimation = () => {
        bodies.forEach(body => {
            Body.applyForce(body, body.position, {
                x: forceX + (Math.random() - 0.5) * 0.006, // Turbulence
                y: (Math.random() - 0.5) * 0.004 // Vertical flutter
            });
        });
        frames++;
        if (frames < totalFrames) {
            requestAnimationFrame(windAnimation);
        } else {
            if (onComplete) onComplete();
        }
    };
    windAnimation();
}

document.addEventListener('DOMContentLoaded', init);
