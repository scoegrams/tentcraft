# 📁 SYSTEM DIRECTIVE: PROJECT "THE GREAT DIVIDE"
**Document Type:** Game Design Document (GDD) / AI Coding Prompt  
**Engine Architecture:** Symmetrical RTS (Strict 1-for-1 class parity, inherited from classic 1995 RTS logic)  
**Brand Identity:** "Cold Reality" — A hyper-realistic, grounded dystopia. Zero sci-fi magic, zero neon cyberpunk tropes. This is concrete, corporate sterilization versus rust, rot, and desperate survival. 

---

## 📖 1. LORE & BACKGROUND: "THE EVICTION"
The world didn't end in a nuclear fire; it ended in a series of algorithmic market crashes known as **"The Eviction."** When global resources dried up, the world's elite consolidated their wealth, bought up the last arable land and clean aquifers, and built **The Perimeter**—a massive, continent-spanning wall of concrete and invisible microwave security grids. 

Inside the Perimeter are **The Gilded (The HAVES)**. They live in a curated, temperature-controlled paradise defended by privatized military companies (PMCs) and manipulative PR algorithms. 
Outside the Perimeter are **The Scavengers (The NOTS)**. Millions of displaced citizens surviving in the toxic runoff of the Gilded's luxury, fighting over scraps, and slowly organizing into a massive, desperate horde ready to breach the gates.

---

## 🎨 2. BRAND IDENTITY & UX DIRECTIVES
For the front-end and UI/UX implementation:
* **The Gilded UI:** Minimalist, transparent glass interfaces, sleek san-serif fonts, sterile white (#FFFFFF) and gold (#D4AF37) accents. Notification sounds are soft, pleasant corporate chimes. 
* **The Scavenger UI:** Cluttered, analog, CRT-monitor aesthetics. Fixed-width fonts, rusted orange (#CC5500) and bruised purple (#483248) accents. Notification sounds are static clicks, geiger-counter ticks, and heavy metallic clangs.

---

## 👑 3. SPECIFIC CHARACTERS (HERO UNITS)
These replace the "Legendary" hero units from classic RTS games. They possess higher HP, unique auras, and immense tactical value.

### THE GILDED (Heroes of the Boardroom)
1.  **CEO Vance Sterling (Heavy Melee / Tank):** * *Lore:* The architect of the Microwave Emitter grid. He views the Scavengers as "unauthorized biological assets."
    * *Asset:* Wears a custom, bespoke exo-suit tailored to look like a three-piece suit. Wields a kinetic pile-bunker. 
    * *Aura:* "Hostile Takeover" - Nearby Enforcers gain +2 Armor.
2.  **Director Evelyn Cross (Caster / Control):** * *Lore:* Head of PR and Psychological Warfare. 
    * *Asset:* Rides in a hovering, bulletproof media-pod.
    * *Skill:* "The Narrative" - A massive AOE Deepfake that causes Scavenger units to attack each other for 10 seconds.

### THE SCAVENGERS (Heroes of the Dirt)
1.  **"Mother" Rust (Heavy Melee / Bruiser):** * *Lore:* A former structural engineer who was left outside during The Eviction. She leads the largest tent city.
    * *Asset:* Wields a massive rotary saw salvaged from a logging machine. Covered in overlapping street signs for armor.
    * *Aura:* "Nothing to Lose" - Nearby Scavengers gain +3 Attack Damage when below 50% HP.
2.  **Cypher, The Virus (Caster / Bio-Hacker):** * *Lore:* A radicalized chemist and dark-web architect.
    * *Asset:* Wears a heavy hazmat suit trailing cables and leaking green gas. 
    * *Skill:* "Systemic Rot" - Disables all Gilded defensive structures in a target area for 15 seconds while dealing ticking poison damage to organic units.

---

## 🏗️ 4. FACTION ARCHITECTURE & CORE LOOP (OOP Classes)
*Developer Note: Inherit base classes for all structures to ensure exact statistical parity.*

| Base Class Type | THE GILDED (Subclass A) | THE SCAVENGERS (Subclass B) | Logic / Output |
| :--- | :--- | :--- | :--- |
| `Resource_Capital` | **Digital Vault** | **Scrap Heap** | Primary currency node. |
| `Resource_Material` | **Bio-Garden** | **The Recycler** | Secondary building material node. |
| `Building_TownHall` | **The Gated Manor** | **The Squat** | Spawns Workers. Resource drop-off. |
| `Building_Housing` | **Tiny Home Cluster** | **The Tent City** | Increases population cap by +4. |
| `Building_Barracks` | **Security HQ** | **The Mess Hall** | Spawns Tier 1 & 2 Melee/Ranged. |
| `Building_Upgrade` | **The Design Studio** | **The Chop Shop** | Tech tree unlocks (Weapon/Armor). |
| `Building_Tower` | **Microwave Emitter** | **The Junk Turret** | Base Defense. |
| `Building_Magic` | **The PR Firm** | **The Computer Lab** | Spawns Casters, unlocks Skills. |

---

## ⚔️ 5. UNIT ROSTER (1-for-1 Object Mapping)

| Base Unit Class | THE GILDED | THE SCAVENGERS | Base Stats (HP/ATK/RNG) |
| :--- | :--- | :--- | :--- |
| `Unit_Worker` | **The Assistant** | **The Scavenger** | 30 / 5 / Melee |
| `Unit_Infantry` | **The Enforcer** (Riot Gear) | **The Hooded** (Garbage Lid) | 60 / 9 / Melee |
| `Unit_Ranged` | **Tactical Guard** (Dart Gun) | **The Slinger** (Glass Shards) | 40 / 8 / 4 Range |
| `Unit_Heavy` | **The Bodyguard** (Vested Heavy)| **The Brute** (Improvised Armor) | 90 / 12 / Melee |
| `Unit_Support` | **The Fixer** (Stim-Injections) | **The Radical** (Adrenaline) | 50 / 6 / Melee + Buffs |
| `Unit_Caster` | **Media Consultant** (Holograms)| **The Hacker** (Poison Tech) | 40 / 4 / 6 Range + Spells|
| `Unit_Siege` | **Cancellation Drone** (EMP) | **The Fire-Eater** (Propane) | 40 / 50 (Suicide Blast) |

---

## ⚙️ 6. CODING DIRECTIVE: THE "STAY AWAY" MECHANIC
This is the core differentiator of the game's combat loop.

**Implementation Logic for Microwave Emitter (Gilded Defense):**
1.  Do NOT use projectile logic.
2.  Use a continuous AOE collision sphere (Radius: 6).
3.  If `EnemyUnit` enters sphere, apply `Status_HeatStress`.
4.  `Status_HeatStress`: 
    * Tick damage: 2 HP per second.
    * Debuff: Reduce `MovementSpeed` by 30%.
    * Audio Hook: Trigger `event_sfx_flesh_sizzle` and `event_vo_unit_panic`.

**Implementation Logic for Junk Turret (Scavenger Defense):**
1.  Use projectile logic (jagged metal/glass).
2.  If `Projectile` hits `EnemyUnit`, deal physical damage.
3.  Apply `Status_Knockback` (Push unit back 1.5 distance units).
4.  Audio Hook: Trigger `event_sfx_metal_clang` and `event_vo_unit_grunt`.

---

## 💻 7. INITIALIZATION PROMPT FOR AI CODER
*When passing this document to the coding agent, append the following command:*

**"Based on the GDD above, generate the C# (or target language) base classes for `Building_Tower`, implementing the specific `MicrowaveEmitter` AOE logic and the `JunkTurret` projectile logic. Include comments referencing the Brand Identity."**