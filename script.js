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

function getCharWidth(char, fontSize) {
    const isKorean = /[\u3131-\uD79D]/.test(char);
    const fontFamily = isKorean ? 'Noto Sans KR' : 'Gloock';
    measurementContext.font = `900 ${fontSize}px ${fontFamily}`;

    // Canvas measureText is very accurate. 
    // We add a tiny buffer (1px) to prevent sub-pixel overlap issues.
    return Math.ceil(measurementContext.measureText(char).width) + 1;
}

// Split text into lines based on width
function calculateLines(chars, fontSize, maxWidth) {
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    chars.forEach(char => {
        const charWidth = getCharWidth(char, fontSize);
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

    const baseFontSize = Math.min(Math.max(32, screenWidth / 6.5), 134);
    // Dynamic Scaling: Decrease font size as characters exceed 10
    const lengthFactor = 1 / (1 + Math.max(0, chars.length - 10) * 0.05);
    const fontSize = Math.max(baseFontSize * lengthFactor, 24);

    const charHeight = fontSize * 0.85; // Tighter height for better stacking
    const textAreaPadding = screenWidth * TEXT_AREA_PADDING;
    const textAreaWidth = screenWidth - (textAreaPadding * 2);
    const lineHeight = charHeight + 110;

    const lines = calculateLines(chars, fontSize, textAreaWidth);
    const totalHeight = lines.length * lineHeight;
    const startY = Math.max(ROPE_Y + charHeight + 20, (screenHeight - totalHeight) / 3.5);

    lines.forEach((lineChars, lineIndex) => {
        const totalLineWidth = lineChars.reduce((sum, char) => sum + getCharWidth(char, fontSize), 0);
        let currentX = (screenWidth - totalLineWidth) / 2;
        const ropeY = startY + lineIndex * lineHeight - 50;

        const ropeBody = Bodies.rectangle(screenWidth / 2, ropeY, screenWidth, 10, {
            isStatic: true,
            render: { visible: false }
        });
        World.add(world, ropeBody);
        ropeBodies.push(ropeBody);

        lineChars.forEach((char) => {
            const charWidth = getCharWidth(char, fontSize);
            const x = currentX + charWidth / 2;
            const y = ropeY + charHeight + 50;

            currentX += charWidth;

            const span = document.createElement('span');
            const isKorean = /[\u3131-\uD79D]/.test(char);
            span.className = `char-span ${isKorean ? 'char-ko' : 'char-en'}`;
            span.textContent = char;
            span.style.fontSize = `${fontSize}px`;
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
                length: 50, // Added length for "hanging" sway
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

    World.clear(world, true);
    createBoundaries();

    charBodies.forEach((body, i) => {
        const offset = body.position.x - oldCenter;
        Body.setPosition(body, { x: newCenter + offset, y: body.position.y });
        World.add(world, body);
    });

    ropeBodies.forEach(body => {
        Body.setPosition(body, { x: newCenter, y: body.position.y });
        World.add(world, body);
    });

    constraints.forEach(c => World.add(world, c));

    fallenBodies.forEach(body => {
        const offset = body.position.x - oldCenter;
        let newX = newCenter + offset;
        let newY = body.position.y;

        if (newY > screenHeight - 20) {
            newY = screenHeight - 20;
        }

        Body.setPosition(body, { x: newX, y: newY });
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
    window.addEventListener('resize', debounce(handleResize, 300));
    input.focus();

    createHangingText('Laundry');
    setInterval(applyWindEffect, 3000);
}

function applyWindEffect() {
    const bodies = [...charBodies, ...fallenBodies];
    if (bodies.length === 0) return;
    let frames = 0;
    const duration = 60;
    const baseForceX = 0.00245;
    const direction = Math.random() > 0.5 ? 1 : -1;
    // Max intensity reduced by 50% (previous max multiplier was 3.0, new max is 1.5)
    const randomMultiplier = 0.5 + Math.random() * 1.0;
    const forceX = baseForceX * randomMultiplier * direction;

    const windAnimation = () => {
        bodies.forEach(body => {
            Body.applyForce(body, body.position, {
                x: forceX + (Math.random() - 0.5) * 0.006, // Increased turbulence
                y: (Math.random() - 0.5) * 0.004 // Increased vertical flutter
            });
        });
        frames++;
        if (frames < duration) requestAnimationFrame(windAnimation);
    };
    windAnimation();
}

document.addEventListener('DOMContentLoaded', init);
