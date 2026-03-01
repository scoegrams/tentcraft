<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Perimeter: RTS Prototype</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background-color: #1a1a1a; color: white; font-family: 'Courier New', Courier, monospace; user-select: none; }
        #gameCanvas { display: block; width: 100%; height: 100%; }
        /* Custom UI overlays */
        #ui-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
        .pointer-events-auto { pointer-events: auto; }
        /* CRT/Gritty overlay effect */
        .scanlines {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
            background-size: 100% 4px, 6px 100%; pointer-events: none; z-index: 50; opacity: 0.4;
        }
    </style>
</head>
<body>

    <canvas id="gameCanvas" oncontextmenu="return false;"></canvas>
    <div class="scanlines"></div>

    <!-- UI Overlay -->
    <div id="ui-layer" class="flex flex-col justify-between p-4">
        <!-- Top Bar -->
        <div class="flex justify-between items-start">
            <div class="bg-black/80 border border-orange-900 p-3 rounded pointer-events-auto shadow-lg shadow-orange-900/20">
                <h1 class="text-xl font-bold text-orange-500 tracking-wider">THE PERIMETER</h1>
                <div class="text-sm text-gray-400">FACTION: <span class="text-orange-400">SCAVENGERS</span></div>
                <div class="text-lg mt-2 font-mono flex items-center gap-2">
                    <div class="w-3 h-3 bg-orange-600 rounded-sm"></div>
                    SCRAP: <span id="scrap-counter" class="text-white font-bold">100</span>
                </div>
            </div>
            
            <div class="bg-black/80 border border-blue-900 p-3 rounded text-right">
                <h1 class="text-xl font-bold text-blue-400 tracking-wider">GILDED TOWERS</h1>
                <div class="text-sm text-gray-400">PLASMANET: <span class="text-blue-300 animate-pulse">ACTIVE</span></div>
                <div class="text-sm mt-2 text-gray-500">OBJECTIVE: DESTROY SECURITY HQ</div>
            </div>
        </div>

        <!-- Bottom Action Panel -->
        <div class="flex justify-center mb-4">
            <div id="action-panel" class="bg-black/90 border-t-2 border-orange-700 p-4 rounded-t-lg pointer-events-auto min-w-[400px] h-[120px] hidden flex-col justify-center">
                <div id="selection-title" class="text-orange-500 font-bold mb-2 uppercase border-b border-gray-700 pb-1">Selection</div>
                <div id="action-buttons" class="flex gap-2">
                    <!-- Buttons injected via JS -->
                </div>
                <div id="selection-desc" class="text-xs text-gray-400 mt-2"></div>
            </div>
        </div>
    </div>

<script>
/**
 * THE PERIMETER - LIGHTWEIGHT RTS ENGINE
 * Architecture: Entity-Component style state machine
 */

// --- GLOBALS & CONFIG ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let width, height;

// Game State
const GAME = {
    scrap: 200, // Increased starting scrap to train early Scrappers
    entities: [],
    particles: [],
    selection: [],
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    dragCurrent: { x: 0, y: 0 },
    lastTime: 0,
    aiTimer: 0,
    aiSpawnRate: 8000, // Enforcers spawn every 8s
    gameOver: false
};

// Colors based on lore
const COLORS = {
    scavenger: '#ea580c', // Orange/Rust
    scavengerDark: '#78350f',
    gilded: '#60a5fa', // Blue/Glass
    gildedDark: '#1e3a8a',
    bgDirt: '#262626',
    bgConcrete: '#171717',
    plasmanet: '#8b5cf6'
};

// --- CLASSES ---

class Particle {
    constructor(x, y, color, speed, life) {
        this.x = x; this.y = y;
        this.vx = (Math.random() - 0.5) * speed;
        this.vy = (Math.random() - 0.5) * speed;
        this.color = color;
        this.life = life;
        this.maxLife = life;
        this.size = Math.random() * 3 + 1;
    }
    update(dt) {
        this.x += this.vx; this.y += this.vy;
        this.life -= dt;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
    }
}

class Entity {
    constructor(x, y, type, faction) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = x; this.y = y;
        this.type = type; // 'hq', 'worker', 'fighter', 'resource'
        this.faction = faction; // 'scavenger', 'gilded', 'neutral'
        this.hp = 100;
        this.maxHp = 100;
        this.radius = 15;
        this.selected = false;
        
        // Movement
        this.vx = 0; this.vy = 0;
        this.speed = 0;
        this.targetX = null; this.targetY = null;
        
        // Actions
        this.targetEntity = null;
        this.state = 'IDLE'; // IDLE, MOVING, GATHERING, ATTACKING, RETURNING
        this.attackRange = 25;
        this.attackDamage = 10;
        this.attackCooldown = 1000;
        this.lastAttack = 0;
        
        // Harvesting
        this.carriedScrap = 0;
        this.carryCapacity = 10;
        
        // Production
        this.productionQueue = [];
        this.currentProductionTime = 0;
        this.currentProductionMax = 0;
    }

    damage(amount) {
        this.hp -= amount;
        // Blood/Sparks
        let pColor = this.faction === 'gilded' ? COLORS.gilded : COLORS.scavengerDark;
        if(this.type === 'hq') pColor = '#ffffff';
        for(let i=0; i<5; i++) GAME.particles.push(new Particle(this.x, this.y, pColor, 5, 500));
        
        if (this.hp <= 0) {
            this.destroy();
        }
    }

    destroy() {
        this.hp = 0;
        // Explosion
        for(let i=0; i<20; i++) GAME.particles.push(new Particle(this.x, this.y, '#ef4444', 8, 800));
        
        if (this.type === 'hq') {
            GAME.gameOver = true;
            setTimeout(() => {
                alert(this.faction === 'gilded' ? "VICTORY! The Security HQ has fallen!" : "DEFEAT! The Squat is destroyed.");
                location.reload();
            }, 1000);
        }
    }

    update(dt) {
        if (this.hp <= 0) return;

        // State Machine
        switch(this.state) {
            case 'IDLE':
                this.vx = 0; this.vy = 0;
                // Auto-aquire targets if fighter
                if (this.type === 'fighter') {
                    let nearest = findNearestEnemy(this, 150);
                    if (nearest) {
                        this.targetEntity = nearest;
                        this.state = 'ATTACKING';
                    }
                }
                break;
                
            case 'MOVING':
                if (this.targetX !== null && this.targetY !== null) {
                    if (moveTo(this, this.targetX, this.targetY, this.speed, dt)) {
                        this.state = 'IDLE';
                        this.targetX = null; this.targetY = null;
                    }
                } else {
                    this.state = 'IDLE';
                }
                break;

            case 'GATHERING':
                if (this.targetEntity && this.targetEntity.hp > 0 && this.targetEntity.type === 'resource') {
                    if (moveTo(this, this.targetEntity.x, this.targetEntity.y, this.speed, dt, 30)) {
                        // Reached resource
                        this.carriedScrap = this.carryCapacity;
                        this.targetEntity.damage(10); // Deplete resource slowly
                        this.state = 'RETURNING';
                    }
                } else {
                    this.state = 'IDLE';
                    this.targetEntity = null;
                }
                break;

            case 'RETURNING':
                let hq = GAME.entities.find(e => e.faction === this.faction && e.type === 'hq');
                if (hq) {
                    if (moveTo(this, hq.x, hq.y, this.speed, dt, 40)) {
                        // Reached HQ, drop off
                        if(this.faction === 'scavenger') GAME.scrap += this.carriedScrap;
                        this.carriedScrap = 0;
                        // Go back to gathering
                        if (this.targetEntity && this.targetEntity.hp > 0) {
                            this.state = 'GATHERING';
                        } else {
                            this.state = 'IDLE';
                        }
                    }
                } else {
                    this.state = 'IDLE'; // No HQ!
                }
                break;

            case 'ATTACKING':
                if (this.targetEntity && this.targetEntity.hp > 0) {
                    let dist = Math.hypot(this.targetEntity.x - this.x, this.targetEntity.y - this.y);
                    if (dist <= this.attackRange) {
                        // In range, stop moving and attack
                        this.vx = 0; this.vy = 0;
                        if (GAME.lastTime - this.lastAttack > this.attackCooldown) {
                            this.targetEntity.damage(this.attackDamage);
                            this.lastAttack = GAME.lastTime;
                            
                            // Visual attack effect (laser or muzzle flash)
                            let atkColor = this.faction === 'gilded' ? COLORS.plasmanet : '#fbbf24';
                            GAME.particles.push(new Particle(this.targetEntity.x, this.targetEntity.y, atkColor, 2, 200));
                        }
                    } else {
                        // Move closer
                        moveTo(this, this.targetEntity.x, this.targetEntity.y, this.speed, dt, this.attackRange - 5);
                    }
                } else {
                    this.state = 'IDLE';
                    this.targetEntity = null;
                }
                break;
        }

        // Apply movement & collision separation
        this.x += this.vx * (dt/16);
        this.y += this.vy * (dt/16);
        separateEntities(this);
        
        // Production Logic for HQ
        if (this.type === 'hq' && this.productionQueue.length > 0) {
            let nextUnit = this.productionQueue[0];
            this.currentProductionMax = nextUnit === 'worker' ? 2000 : 4000;
            this.currentProductionTime += dt;
            
            if (this.currentProductionTime >= this.currentProductionMax) {
                if (nextUnit === 'worker') createWorker(this.x + 60, this.y + 60, this.faction);
                else if (nextUnit === 'fighter') createFighter(this.x + 60, this.y + 60, this.faction);
                
                this.productionQueue.shift();
                this.currentProductionTime = 0;
                if (this.selected) updateUI();
            }
        }
        
        // Bounds
        this.x = Math.max(this.radius, Math.min(width - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(height - this.radius, this.y));
    }

    draw(ctx) {
        if (this.hp <= 0) return;
        
        ctx.save();
        ctx.translate(this.x, this.y);

        // Selection ring
        if (this.selected) {
            ctx.beginPath();
            ctx.arc(0, 0, this.radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#22c55e'; // Green select
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Base shape
        ctx.beginPath();
        if (this.type === 'hq') {
            ctx.rect(-this.radius, -this.radius, this.radius*2, this.radius*2);
            ctx.fillStyle = this.faction === 'gilded' ? COLORS.gildedDark : COLORS.scavengerDark;
            ctx.fill();
            ctx.strokeStyle = this.faction === 'gilded' ? COLORS.gilded : COLORS.scavenger;
            ctx.lineWidth = 3;
            ctx.stroke();
        } else if (this.type === 'resource') {
            // Draw as an Abandoned Tent for looting
            ctx.moveTo(0, -this.radius);
            ctx.lineTo(this.radius, this.radius);
            ctx.lineTo(-this.radius, this.radius);
            ctx.closePath();
            ctx.fillStyle = '#4b5563'; // Tarp gray
            ctx.fill();
            ctx.strokeStyle = '#1f2937';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Tent opening
            ctx.beginPath();
            ctx.moveTo(0, -this.radius/2);
            ctx.lineTo(this.radius/2, this.radius);
            ctx.lineTo(-this.radius/2, this.radius);
            ctx.fillStyle = '#000000';
            ctx.fill();
        } else {
            // Units
            if (this.faction === 'gilded') {
                // Sleek Enforcers
                ctx.moveTo(0, -this.radius);
                ctx.lineTo(this.radius, this.radius);
                ctx.lineTo(-this.radius, this.radius);
                ctx.closePath();
                ctx.fillStyle = COLORS.gilded;
            } else {
                // Rugged Scavengers
                ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
                ctx.fillStyle = this.type === 'worker' ? '#b45309' : COLORS.scavenger;
            }
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // HP Bar (if damaged)
        if (this.hp < this.maxHp && this.type !== 'resource') {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(-15, -this.radius - 10, 30, 4);
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(-15, -this.radius - 10, 30 * (this.hp / this.maxHp), 4);
        }

        // Production Bar (if HQ is building)
        if (this.type === 'hq' && this.productionQueue.length > 0) {
            ctx.fillStyle = '#4b5563'; // Dark gray background
            ctx.fillRect(-20, -this.radius - 20, 40, 6);
            ctx.fillStyle = '#eab308'; // Yellow progress
            ctx.fillRect(-20, -this.radius - 20, 40 * (this.currentProductionTime / this.currentProductionMax), 6);
        }

        ctx.restore();
    }
}

// --- HELPERS ---

function moveTo(entity, tx, ty, speed, dt, stopDist = 5) {
    let dx = tx - entity.x;
    let dy = ty - entity.y;
    let dist = Math.hypot(dx, dy);
    
    if (dist <= stopDist) {
        entity.vx = 0; entity.vy = 0;
        return true; // Reached
    }
    
    let dirX = dx / dist;
    let dirY = dy / dist;
    entity.vx = dirX * speed;
    entity.vy = dirY * speed;
    return false;
}

function separateEntities(entity) {
    if (entity.type === 'hq' || entity.type === 'resource') return; // Immovable
    
    for (let other of GAME.entities) {
        if (other === entity || other.hp <= 0 || other.type === 'resource') continue;
        
        let dx = entity.x - other.x;
        let dy = entity.y - other.y;
        let dist = Math.hypot(dx, dy);
        let minDist = entity.radius + other.radius + 2;
        
        if (dist < minDist && dist > 0) {
            let pushForce = (minDist - dist) / 2;
            let px = (dx / dist) * pushForce;
            let py = (dy / dist) * pushForce;
            
            entity.x += px; entity.y += py;
            if(other.type !== 'hq') {
                other.x -= px; other.y -= py;
            }
        }
    }
}

function findNearestEnemy(entity, maxDist) {
    let nearest = null;
    let minDist = maxDist;
    for (let other of GAME.entities) {
        if (other.hp <= 0 || other.faction === entity.faction || other.type === 'resource') continue;
        let dist = Math.hypot(entity.x - other.x, entity.y - other.y);
        if (dist < minDist) {
            minDist = dist;
            nearest = other;
        }
    }
    return nearest;
}

// --- SPARTA FACTORIES ---

function createHQ(x, y, faction) {
    let hq = new Entity(x, y, 'hq', faction);
    hq.radius = 40;
    hq.maxHp = 1000;
    hq.hp = 1000;
    GAME.entities.push(hq);
    return hq;
}

function createWorker(x, y, faction) {
    let w = new Entity(x, y, 'worker', faction);
    w.speed = 1.5;
    w.radius = 8;
    w.maxHp = 40; w.hp = 40;
    w.attackDamage = 2; // Weak
    GAME.entities.push(w);
}

function createFighter(x, y, faction) {
    let f = new Entity(x, y, 'fighter', faction);
    f.speed = 2.0;
    f.radius = 10;
    f.maxHp = 80; f.hp = 80;
    
    if (faction === 'gilded') {
        f.attackRange = 80; // Enforcers have ranged stun-darts
        f.attackDamage = 8;
        f.attackCooldown = 800;
        f.maxHp = 120; f.hp = 120;
    } else {
        f.attackRange = 25; // Hooded are melee
        f.attackDamage = 15;
        f.attackCooldown = 1000;
    }
    GAME.entities.push(f);
}

function createTent(x, y) {
    let r = new Entity(x, y, 'resource', 'neutral');
    r.radius = 20;
    r.maxHp = 500; r.hp = 500; // Acts as scrap capacity for the tent
    GAME.entities.push(r);
}

// --- INPUT HANDLING ---

canvas.addEventListener('mousedown', (e) => {
    if(GAME.gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.button === 0) { // Left Click - Select
        GAME.isDragging = true;
        GAME.dragStart = { x, y };
        GAME.dragCurrent = { x, y };
        
        // Single click selection fallback
        GAME.entities.forEach(ent => ent.selected = false);
    } 
    else if (e.button === 2) { // Right Click - Action
        let target = null;
        // Check if clicked ON an entity
        for (let ent of GAME.entities) {
            if (ent.hp > 0 && Math.hypot(ent.x - x, ent.y - y) <= ent.radius + 5) {
                target = ent;
                break;
            }
        }

        // Issue orders to selected player units
        GAME.entities.forEach(ent => {
            if (ent.selected && ent.faction === 'scavenger' && ent.type !== 'hq') {
                if (target) {
                    if (target.faction === 'gilded') {
                        ent.state = 'ATTACKING';
                        ent.targetEntity = target;
                    } else if (target.type === 'resource' && ent.type === 'worker') {
                        ent.state = 'GATHERING';
                        ent.targetEntity = target;
                    }
                } else {
                    // Move
                    ent.state = 'MOVING';
                    ent.targetX = x + (Math.random() * 20 - 10); // slight variance
                    ent.targetY = y + (Math.random() * 20 - 10);
                    ent.targetEntity = null;
                    
                    // Visual marker
                    GAME.particles.push(new Particle(x, y, '#22c55e', 0, 300));
                }
            }
        });
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (GAME.isDragging) {
        const rect = canvas.getBoundingClientRect();
        GAME.dragCurrent.x = e.clientX - rect.left;
        GAME.dragCurrent.y = e.clientY - rect.top;
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0 && GAME.isDragging) {
        GAME.isDragging = false;
        
        // Calculate selection box
        let minX = Math.min(GAME.dragStart.x, GAME.dragCurrent.x);
        let maxX = Math.max(GAME.dragStart.x, GAME.dragCurrent.x);
        let minY = Math.min(GAME.dragStart.y, GAME.dragCurrent.y);
        let maxY = Math.max(GAME.dragStart.y, GAME.dragCurrent.y);
        
        // Determine if it was a tiny click or a drag
        let isClick = (maxX - minX < 5) && (maxY - minY < 5);

        let selectedCount = 0;
        GAME.entities.forEach(ent => {
            if (ent.hp > 0 && ent.faction === 'scavenger') {
                if (isClick) {
                    // Point selection
                    if (Math.hypot(ent.x - GAME.dragStart.x, ent.y - GAME.dragStart.y) <= ent.radius) {
                        ent.selected = true;
                        selectedCount++;
                    }
                } else {
                    // Box selection (only select mobile units, not HQ, unless only HQ is boxed)
                    if (ent.x >= minX && ent.x <= maxX && ent.y >= minY && ent.y <= maxY) {
                        if (ent.type !== 'hq') {
                            ent.selected = true;
                            selectedCount++;
                        }
                    }
                }
            }
        });
        
        // If nothing mobile was selected in box, try selecting HQ if it was in box
        if (selectedCount === 0 && !isClick) {
            let hq = GAME.entities.find(e => e.type === 'hq' && e.faction === 'scavenger');
            if (hq && hq.x >= minX && hq.x <= maxX && hq.y >= minY && hq.y <= maxY) {
                hq.selected = true;
            }
        }

        updateUI();
    }
});

// --- UI MANAGEMENT ---

const actionPanel = document.getElementById('action-panel');
const actionButtons = document.getElementById('action-buttons');
const selectionTitle = document.getElementById('selection-title');
const selectionDesc = document.getElementById('selection-desc');
const scrapCounter = document.getElementById('scrap-counter');

function updateUI() {
    scrapCounter.innerText = Math.floor(GAME.scrap);
    
    let selected = GAME.entities.filter(e => e.selected && e.hp > 0);
    
    if (selected.length === 0) {
        actionPanel.classList.add('hidden');
        actionPanel.classList.remove('flex');
        return;
    }
    
    actionPanel.classList.remove('hidden');
    actionPanel.classList.add('flex');
    actionButtons.innerHTML = ''; // clear

    if (selected.length === 1 && selected[0].type === 'hq') {
        selectionTitle.innerText = "THE SQUAT (HQ)";
        
        let qLen = selected[0].productionQueue.length;
        let qText = qLen > 0 ? ` | Queued: ${qLen}` : "";
        selectionDesc.innerText = `Produces reinforcements using recovered Scrap.${qText}`;
        
        // Train Worker
        let btn1 = document.createElement('button');
        btn1.className = "bg-orange-800 hover:bg-orange-600 text-white px-4 py-2 rounded text-sm font-bold border border-orange-500 transition-colors";
        btn1.innerText = "Train Scrapper (50)";
        btn1.onclick = () => {
            if (GAME.scrap >= 50) {
                GAME.scrap -= 50;
                selected[0].productionQueue.push('worker');
                updateUI();
            }
        };
        
        // Train Fighter
        let btn2 = document.createElement('button');
        btn2.className = "bg-red-800 hover:bg-red-600 text-white px-4 py-2 rounded text-sm font-bold border border-red-500 transition-colors";
        btn2.innerText = "Train The Hooded (100)";
        btn2.onclick = () => {
            if (GAME.scrap >= 100) {
                GAME.scrap -= 100;
                selected[0].productionQueue.push('fighter');
                updateUI();
            }
        };
        
        actionButtons.appendChild(btn1);
        actionButtons.appendChild(btn2);
        
    } else {
        let workers = selected.filter(e => e.type === 'worker').length;
        let fighters = selected.filter(e => e.type === 'fighter').length;
        selectionTitle.innerText = `SELECTED: ${selected.length} UNITS`;
        selectionDesc.innerText = `${workers} Scrappers | ${fighters} The Hooded. Right-click Tents to loot, or enemies to attack.`;
    }
}

// --- GAME LOOP ---

function init() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    // Spawn Player HQ (Left)
    createHQ(100, height / 2, 'scavenger');
    
    // Spawn Enemy HQ (Right)
    createHQ(width - 150, height / 2, 'gilded');

    // Spawn initial Tents (Left side) to loot
    for(let i=0; i<8; i++) {
        createTent(150 + Math.random()*250, 100 + Math.random()*(height-200));
    }

    // Spawn starting units
    createWorker(180, height/2 - 30, 'scavenger');
    createWorker(180, height/2 + 30, 'scavenger');

    GAME.lastTime = performance.now();
    requestAnimationFrame(gameLoop);
    
    // UI Update interval
    setInterval(updateUI, 500);
}

function gameLoop(timestamp) {
    let dt = timestamp - GAME.lastTime;
    GAME.lastTime = timestamp;
    if (dt > 100) dt = 100; // Cap dt to prevent huge jumps

    update(dt);
    draw();

    if(!GAME.gameOver) {
        requestAnimationFrame(gameLoop);
    }
}

function update(dt) {
    // Clean dead entities
    GAME.entities = GAME.entities.filter(e => e.hp > 0);
    GAME.particles = GAME.particles.filter(p => p.life > 0);

    // Update entities
    GAME.entities.forEach(ent => ent.update(dt));
    GAME.particles.forEach(p => p.update(dt));

    // AI Logic (The Gilded)
    GAME.aiTimer += dt;
    if (GAME.aiTimer >= GAME.aiSpawnRate) {
        GAME.aiTimer = 0;
        let enemyHq = GAME.entities.find(e => e.faction === 'gilded' && e.type === 'hq');
        let playerHq = GAME.entities.find(e => e.faction === 'scavenger' && e.type === 'hq');
        
        if (enemyHq && playerHq) {
            // Spawn an Enforcer
            let f = new Entity(enemyHq.x - 60, enemyHq.y + (Math.random()*40-20), 'fighter', 'gilded');
            f.speed = 1.2;
            f.radius = 12;
            f.attackRange = 100; // Plasmanet dart rifles
            f.attackDamage = 8;
            f.attackCooldown = 800;
            f.maxHp = 150; f.hp = 150;
            
            // Send directly to player base
            f.state = 'ATTACKING';
            f.targetEntity = playerHq;
            GAME.entities.push(f);
        }
    }
}

function draw() {
    // Background gradient (Dirt -> Concrete)
    let grd = ctx.createLinearGradient(0, 0, width, 0);
    grd.addColorStop(0, COLORS.bgDirt);
    grd.addColorStop(0.5, '#202020');
    grd.addColorStop(1, COLORS.bgConcrete);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);

    // Draw Plasmanet line / Perimeter
    ctx.strokeStyle = COLORS.plasmanet;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 15]);
    ctx.beginPath();
    ctx.moveTo(width * 0.7, 0);
    ctx.lineTo(width * 0.7, height);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Plasmanet glow
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.plasmanet;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw Entities
    // Sort so units render over resources
    GAME.entities.sort((a,b) => (a.type === 'resource' ? -1 : 1)).forEach(ent => ent.draw(ctx));
    
    // Draw Particles
    GAME.particles.forEach(p => p.draw(ctx));

    // Draw Drag Selection Box
    if (GAME.isDragging) {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)'; // green
        ctx.fillStyle = 'rgba(34, 197, 94, 0.1)';
        ctx.lineWidth = 1;
        let rx = Math.min(GAME.dragStart.x, GAME.dragCurrent.x);
        let ry = Math.min(GAME.dragStart.y, GAME.dragCurrent.y);
        let rw = Math.abs(GAME.dragStart.x - GAME.dragCurrent.x);
        let rh = Math.abs(GAME.dragStart.y - GAME.dragCurrent.y);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
    }
}

// Start
window.onload = init;
window.onresize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
};

</script>
</body>
</html>