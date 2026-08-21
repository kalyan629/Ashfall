# ASHFALL — World Bible

> The source of truth for story, tone, systems, and **art direction**.
> Phase 4 asset generation reads its prompts from §8. If a material, colour, or
> silhouette is not described here, it does not get generated.

Draft 2 · 2026-08-21 · *supersedes Draft 1 (surface-centric)*

---

## 1. The premise

Ash has been falling for eleven years and has never stopped. Humanity is
believed finished. Below ground, millions are alive inside **Marrow** and
shelters like it — sixty kilometres of converted mine workings and natural
cavern, nine levels deep, ninety thousand people, sealed behind a gate nobody
can open.

**The bunker is the world.** Not a hub, not a safe room — the entire game space.
It is enormous, only partly mapped, partly powered, and parts of it are not
empty. Players live here, work here, build here, and fight for space here.

The gate opens eventually. What is beyond it is not this game's problem yet.

## 2. What everyone believes vs. what is true

| Layer | Believed | True |
|---|---|---|
| **The event** | A supervolcano. An act of nature. | No crater, no caldera, no source anyone ever found. |
| **The timing** | The shelters were emergency improvisation. | Conversion began **three years before** the ash. Someone knew. |
| **The ash** | Pulverised rock. Inert. | Manufactured. Engineered particulate, not fragments. |
| **The cause** | An accident, or God, or nothing. | A stratospheric aerosol programme run to stop runaway warming. It worked. |
| **Why it continues** | It is weather. | The injector platforms are autonomous, solar, self-repairing, still flying. Nobody left knows how to give them an order. |
| **Why the animals changed and we did not** | Nobody asks. It is just how things are. | **The aerosol was engineered human-safe.** Deliberately. Every other vertebrate was outside its tolerance. |

That last row is the spine of the horror. Somebody sat in a room and specified
which species the intervention would spare.

## 3. The Gate, and the seven wards

Marrow's main doors — **the Headworks Gate** — are sealed under
**threshold control**. The original engineers split authority so no single
person, and no single administration, could ever open it alone.

- **Seven wards exist. Five must be physically present at the gate, at the same
  time, to cycle it.** Five different people, five different keys, one moment.
- The wards were dispersed into the deep workings before the seal. Their
  locations were deliberately not written down in one place.
- **The Directorate does not want them found.** An open gate ends its reason
  to exist.

This is *k*-of-*n* secret sharing expressed as level design. It matters for
three reasons: no player can ever solo the endgame, the final act is inherently
a social event, and betrayal is structurally possible — a keyholder can simply
not turn up.

### 3.1 Difficulty philosophy — read this before tuning anything

The design intent is that **most players never finish the ward hunt, and that
this is fine.** The wards are the horizon, not the content. The content is
living in Marrow.

The failure mode to avoid: *impossible* feels like being cheated, while
*distant* feels like awe. The difference is entirely whether progress is
**visible and public**:

- Each ward found is a **server-wide event**. The sector it unlocks stays
  unlocked for everyone, forever. The Directorate visibly reacts — patrols
  increase, prices move, notices go up.
- A ward is a multi-week achievement for an organised group, not a lucky drop.
- Standing in a sector that somebody else's crew opened last month, and knowing
  who did it, is the point.

Ward challenges ship incrementally. Wards 1–2 at launch; the rest arrive as
updates. The hunt should stay unfinished for a long time on purpose.

## 4. Marrow

Formerly Marrow Deep, a copper-zinc mine. The Directorate expanded it into a
city. Nine levels, roughly sixty kilometres of workings, ~90,000 people.
Powered by a geothermal tap on Level 7 that is one failure away from taking the
whole place dark.

| Level | Name | Character |
|---|---|---|
| 0 | **Headworks** | The Gate. Sealed. Custody's fortress. Ritualised, forbidden. |
| 1 | **The Landing** | Arrivals, registry, the noticeboard. Where new players spawn. |
| 2 | **The Commons** | Market, canteens, bunks. Loud, warm, crowded. Marrow's heart. |
| 3 | **The Works** | Air, water, power. Four people truly understand it. |
| 4 | **Grow** | Hydroponics under sodium and magenta. The only vivid colour. Guarded. |
| 5 | **The Cut** | Workshops, salvage sorting, active mining. Where players work. |
| 6 | **The Warrens** | Derelict. Half-powered. **Claimable.** Where players build. |
| 7 | **The Tap** | Geothermal. Hot, deafening, lethal, essential. |
| 8 | **The Sumps** | Flooded, unmapped, unlit. Where the wards are. Where the fauna live. |

Rule of thumb: **the deeper you go, the more valuable and the more likely to
kill you.** Levels 1–5 are civilisation. 6 is frontier. 7–8 are the game.

## 5. The Directorate

Marrow is governed, and not gently.

- **The Directorate** administers everything: scrip, rations, tenancy, filters,
  the registry. Bureaucratic rather than theatrical. It is not cartoonishly
  evil — it kept ninety thousand people alive for eleven years and it will
  remind you of that.
- **Custody** is its security arm. Custodians are armoured, numerous, and
  legally entitled to almost anything. They are not a raid boss; they are
  *weather*. You do not beat Custody, you avoid Custody.
- **The tension that drives the whole economy:** the Directorate needs the deep
  sectors scavenged, so it employs players to go down. It also cannot allow the
  wards to be found. **Your employer is your antagonist**, and both of you know it.

### 5.1 Scrip and the shops

Currency is **scrip**, denominated in **hours** — backed by certified filter
media, the one thing in Marrow with non-negotiable value. "That'll run you eight
hundred hours."

Shops in the Commons sell everything: tools, weapons, lights, filters,
fortification materials, medicine. The Directorate sets prices and takes a cut
of every transaction. Player-to-player trade exists and is technically illegal.

Scrip sinks, so the economy does not inflate into nonsense: tenancy rent,
filter replacement, repair costs, respawn fees, Custody fines, bribes.

## 6. The fauna

The ash spared humans by design. Nothing else.

Marrow's lower workings broke into natural cave systems that were never properly
sealed, and ash-bearing groundwater has been seeping in for eleven years. The
things down there were bats, rats, cave fauna, and the Directorate's own escaped
livestock. They are none of those things now.

Each has one distinct silhouette and one behavioural hook. Four is enough to
launch; more later.

| Name | From | Hook |
|---|---|---|
| **Drift** | bats | Ceiling-dwelling. Hunts by sound. The ventilation hum masks you — **when the hum stops, you are audible.** |
| **Choir** | rats | Never alone, ever. Coordinated. Floods a corridor from both ends. |
| **Sow** | grow-level livestock | Enormous, armoured, territorial. **Breaks fortifications.** The reason bases need real walls. |
| **The Long** | unknown, cave-native | Level 8 only. Rare. Never clearly seen. Does not always attack. |

Design rule: these are **animals, not monsters**. They are hungry, territorial,
and afraid of light and fire. They can be avoided, deterred, and understood.
Nothing in Marrow hates you. That is scarier.

## 7. What players actually do

### 7.1 The loop

**Work → equip → go deeper → hold ground → go deeper still.**

1. **Work.** Take Directorate contracts on Levels 5–6. Earn scrip.
2. **Equip.** Buy light, air, tools, weapons, walls from the Commons.
3. **Descend.** Levels 6→8. Value and lethality rise together.
4. **Hold.** Claim a derelict sector in the Warrens. Fortify it. Defend it.
5. **Hunt.** Eventually, the wards.

### 7.2 Holding ground — the adrenaline

This is the emotional core, and it is where the game gets its teeth.

- Derelict sectors in the Warrens are **claimable**. Clear it, power it,
  fortify it, and it is yours and your crew's.
- **Sows break walls.** Choir floods corridors. A base that is not maintained
  does not survive. Defence is real work, not decoration.
- **The tenancy choice, which should be genuinely hard:**
  - **Registered** — pay rent to the Directorate. Custody will not raid you.
    But they know exactly where you live, and they can revoke it.
  - **Squatted** — free, hidden, unregistered. Nobody protects you, and if
    Custody finds you they take everything.

### 7.3 Cooperation is structural, not moral

Design *objects* so that people need people. The airlock between sectors takes
two to cycle. The cage lift needs someone at the winch. Heavy salvage is a
two-person carry. And five people must stand at the Gate together.

Never ask players to be nice. Build doors that need two hands.

### 7.4 Exploration must feel real

His words, and the retention mechanic. What that means concretely:

- **No minimap and no quest arrow.** You navigate by landmark, painted signage,
  and memory. Maps are *items* — bought, drawn, traded, and often wrong.
- **Darkness is a real resource.** Light is finite and light attracts things.
- **The world is hand-authored where it counts.** Procedural generation fills
  the deep workings; every named place is built by hand.
- **Silence and scale.** Long walks with nothing happening are not dead time —
  they are what makes the encounters land.

## 8. Art direction — the part Phase 4 consumes

### 8.1 The core contrast

> **The inhabited levels are warm, saturated, cluttered, human.
> The deep is cold, desaturated, vast, and silent.**

Every asset pushes one way. Nothing sits in the middle.

### 8.2 Palette

| Role | Colour | Notes |
|---|---|---|
| Base | cold grey-blue shotcrete and concrete | the canvas |
| Key light, inhabited | **sodium amber** | warm pools, harsh falloff, the colour of safety |
| Signature accent | **verdigris green** (copper oxide) | Marrow's identity; pipework, old fittings |
| Accent | **rust orange** | oxidised steel, ore stain |
| Grow level | magenta grow-light + saturated leaf green | the only vivid colour; should feel sacred |
| The deep (6–8) | near-black, wet grey, pale mineral white | your own light is the only light |
| Directorate / Custody | **flat institutional grey-green**, stencilled numbers | uniform, printed, cold — the opposite of everything hand-made |
| Warning / UI | hazard yellow, hand-painted stencil | never neon, never glowing |

**Custody reads as printed. Everyone else reads as hand-made.** That single
contrast does the political worldbuilding without a word of dialogue.

### 8.3 Materials to generate (tileable)

Inhabited: shotcrete, raw drilled rock face, galvanised steel plate, riveted
steel, oxidised copper pipe, rust sheet, worn rubber matting, cable bundles,
tarpaulin, salvaged domestic fabric, chipped enamel paint, concrete with rebar
bleed, sandbag, wooden crate, ore rail and sleeper, hand-painted signage.

Deep: wet limestone, flowstone, mineral crust, black water, mud, collapsed
timber, corroded ductwork, fungal bloom, bone accumulation.

Fortification: scrap plate welds, mesh, salvaged door, brace timber, spikes.

### 8.4 Rules that keep it from looking generic

- **No retrofuturism.** No 1950s Americana, no chrome, no jumpsuits, no
  Vault-Tec pastiche. This is 2020s civil infrastructure eleven years without a
  parts supplier.
- **No glowing screens as set dressing.** Power is scarce. A lit screen is an event.
- **Inhabited levels are repaired, not ruined** — patches, welds, mismatched
  paint, zip ties, hand-lettered labels. Ruin belongs below Level 6.
- **Hand-lettering everywhere.** Signage is painted by people. This sells
  "inhabited" harder than any amount of grime.
- **Nothing is symmetrical.** It was a mine. It was never designed for this.

### 8.5 Audio direction

The ventilation hum is constant — **and it is a game mechanic**: it masks your
sound from Drift. When it stops, you are audible, and that is the scariest sound
in the game. Water. Distant machinery. Voices carrying down drifts from rooms
you cannot see. In the deep: your own breathing, and something moving that is
not you.

## 9. Names and language

- Surface trips do not exist yet. Deep trips are **descents**. People who do
  them are **divers**.
- The ash is just "the ash" — never "the Ashfall", never capitalised in
  dialogue. People do not use dramatic names for weather they live in.
- Year Zero was the first ashfall. It is currently **Year Eleven**.
- Money is **hours**. Authority is **the Directorate**. Police are **Custody**.
- The keys are **wards**. The doors are **the Gate**.

## 10. Open questions

- Do other shelters exist and can Marrow reach them? *(Proposed: radio contact,
  degrading, and not all of them still answer.)*
- Is player death permanent? *(Proposed: no — but you drop everything carried,
  and recovery is a run in itself. Punishment is loss and social, not deletion.)*
- Can players join Custody? *(Proposed: yes, eventually. A player faction with
  real power over other players is the strongest endgame content there is.)*
- What is the Long?
