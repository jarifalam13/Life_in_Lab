# Life as Duburi

![Life as Duburi title screen](screenshots/title.jpg)

**Life as Duburi** is an underwater robotics game by **Team BRACU DUBURI**. You are an
autonomous underwater vehicle on a real AUV-competition course: pass the gate, run the slalom,
drop markers in the bin, fire torpedoes through a board, clean up trash at the octagon and
come home. 1 to 4 players in the same water on one screen — PS5-couch style split screen,
keyboards or gamepads, with optional CPU opponents.

The vehicles run on the **DUBURI ROV simulator**'s own physics: 6-DOF hydrodynamics,
Blue Robotics T200 / T500 thruster curves, ArduSub-style stabilise + depth hold, EOS-80 sea
water. The physics modules in `src/physics`, `src/alloc`, `src/core` and `src/hydro` come
unchanged from the [DUBURI simulator](https://github.com/jarifalamclaude-max/simulator).

## ▶ Play

* **Offline, no install:** download [`dist/life-as-duburi.html`](dist/life-as-duburi.html) and
  double-click it. Everything (code, textures, logo, sound) is inside that one file.
* **On GitHub Pages:** in *Settings → Pages* choose branch `main`, folder `/docs`; the game is
  then at `https://jarifalamclaude-max.github.io/LIFE_AS_DUBURI/`.

Chrome, Edge or Firefox with WebGL2. Gamepads (PlayStation / Xbox) work in Chrome and Edge.
If a laptop struggles, set *Graphics* to Medium or Low in the pause menu.

## Join like on a console

![Lobby](screenshots/lobby.jpg)

Press **✕ / A** on a controller, **Space** (left keyboard) or **Enter** (right keyboard) to join.
Each player picks a vehicle with **◀ ▶** and a colour with **▲ ▼**, **△ / Y** adds a CPU
opponent, **Options / Start** starts the match. The screen splits by itself: one player full
screen, two side by side, three or four in quarters (with three, the fourth quarter is a TV
camera that follows the leader, with live standings).

![Split screen](screenshots/split-screen.jpg)

## Vehicles

| Vehicle | Build | Character |
|---|---|---|
| **Duburi** | open frame, 8 × T200 vectored (BlueROV2 Heavy layout) | full 6-DOF, good at everything, clean rolls for gate style |
| **Dubo Mini** | mini AUV, **5** small thrusters: 2 drive, 1 lateral tunnel, 2 vertical tunnels | light and quick to strafe, does pitch flips, gets pushed by current |
| **Barracuda** | torpedo AUV, 5 × T200 | fastest (2 m/s) but turns slowly and cannot roll |
| **Kraken** | box frame, 6 × T500 | heavy, very stable, shrugs off current, no pitch control |
| **Manta** | flat wing, 8 × T200 | the stunt bot — rolls fast, a bit twitchy in waves |

Speeds, turn rates and controllable axes in the lobby are computed from each design's
thrusters and drag, not typed in.

## Water

| Swimming pool | Pacific Ocean | Arctic Ocean | Atlantic Ocean |
|---|---|---|---|
| ![](screenshots/pool.jpg) | ![](screenshots/pacific.jpg) | ![](screenshots/arctic.jpg) | ![](screenshots/atlantic.jpg) |
| 7 m deep, 26 °C fresh water, tiled pool | 12 m, 22 °C reef lagoon, sand and coral, swell | 15 m, −1.5 °C under the sea ice, marine snow | 10 m, 12 °C, green and murky, kelp, 0.17 m/s current |

Depth can also be set to 5–20 m in the lobby. The water is physical, not just a look: density
comes from temperature and salinity (EOS-80), so the same vehicle is ~3 % more buoyant in the
Arctic than in the pool, and current, turbulence and waves really push you around.

## Graphics and sound

* Post-processing on every split-screen view: bloom, underwater colour absorption that gets
  stronger with depth and murk, refraction wobble, vignette, chromatic aberration, film grain.
* Sun shadows, image-based reflections on metal and acrylic, caustics on the floor, god rays,
  thruster bubbles that rise and pop at the surface, marine snow, fish, kelp and ice.
* Synthesised underwater sound: each thruster's blade-pass hum and motor whine follow its real
  rpm, prop wash and cavitation, muffled water acoustics with a dark room echo, bubbles and
  ambience, hydrophone pings from the pingers, splashes, thuds and gripper servos. Other
  vehicles are heard by distance and direction.
* Graphics quality High / Medium / Low in the pause menu.

## The tasks

| | Task | What to do |
|---|---|---|
| 0 | **Heading out** | Optional coin flip sets your start heading. Dive before leaving the start zone. |
| 1 | **Gate** | Pass under the reef-shark or sawfish side: that is *your* animal for the run. Roll / pitch / yaw quarter-turns in the gate zone score style. |
| 2 | **Slalom** | 3 sets of white / red / white pipes near the floor. Keep the red pipe on the same side as at the gate. |
| 3 | **Bin** | Drop 2 markers in the 12 × 24 in bin, in your animal's half (use the down camera). |
| 4 | **Torpedoes** | Fire 2 torpedoes through the 4 in openings, your animal first, from behind the 2 m line. |
| 5 | **Octagon** | Follow the 30 kHz pinger. Put the cup and spoon in their baskets, spin once per item, surface inside the octagon, face your animal. |
| 6 | **Return home** | Back through the gate under water. |

| Gate | Torpedo board | Bin (down camera) |
|---|---|---|
| ![](screenshots/gate.jpg) | ![](screenshots/torpedo-board.jpg) | ![](screenshots/bin.jpg) |

**Rules:** the gate must come first; surfacing anywhere except inside the octagon is a *breach*
and ends the run; the best run counts; a time bonus (100 points per minute left) needs gate +
bin or torpedo + octagon surface.

### Skip, forfeit, leave, quit

![Pause menu](screenshots/pause.jpg)

Each player has their own pause menu (**Start / Options**, **Tab** or **Backspace**; **Esc** for
player 1), driven with their own controller:

* **Skip task** — no points for it; you are moved to the start of the next task.
* **End run** — stop here and keep the points.
* **Forfeit run** — lose this run's points and start again from the dock.
* **Leave match** — you drop out, the others keep playing and the screen re-splits.
* **Restart match** / **Quit to main menu**.

## Controls

| | Keyboard left | Keyboard right | Gamepad (ArduSub layout) |
|---|---|---|---|
| Forward / back | W / S | ↑ / ↓ | right stick ↕ |
| Turn | A / D | ← / → | left stick ↔ |
| Strafe | Q / E | J / L | right stick ↔ |
| Up / down | R / F | I / K | left stick ↕ (or triggers) |
| Roll / pitch (style) | Z X / T G | U O / Y H | LB RB / D-pad |
| Drop marker / fire torpedo / gripper | V / B / C | N / M / , | ✕ A / ○ B / □ X |
| Camera (chase → front → down) | 1 | 7 | △ Y |
| Depth hold on / off | 2 | 8 | Share / Back |
| End run / forfeit / skip task | 3 / 4 / 5 | 9 / 0 / − | L3 / R3 / menu |
| Pause menu | Tab or Esc | Backspace | Options / Start |

Hold Shift for fine control. The HUD shows depth, heading, speed, net buoyancy, an attitude
ball, the hydrophone ring pointing at the 30 kHz (octagon) and 25 kHz (torpedo) pingers, a
mini-map and your task list.

![Results](screenshots/results.jpg)

## Develop

```bash
npm install
npm run build      # -> dist/life-as-duburi.html and docs/index.html
npm test           # headless: physics, rules, skip / forfeit / leave, full CPU runs in every water
npm run e2e        # browser test with screenshots (needs Playwright + Chromium)
```

```
src/
  main.js       entry: renderer, split screen, pause menus, game loop
  sim/          vehicles, course layout, task judging, autopilot (no graphics, runs in node)
  render/       scenery, course elements, vehicle models, post-processing, bubbles, shadows
  ui/           lobby and menus, HUD, keyboard / gamepad input, sound engine
  physics/ alloc/ core/ hydro/   from the DUBURI simulator: water, thrusters, allocation, maths
assets/         DUBURI logo and the task pictures
tests/          node tests + browser test
dist/           the built game (one HTML file)
docs/           the same file for GitHub Pages
screenshots/    pictures for this README
```

## Credits

Team **BRACU DUBURI**, BRAC University. Built on the DUBURI ROV simulator. Task layout, sizes
and pictures follow the 2025 AUV-competition team handbook published by RoboNation. Licence:
GPL-3.0-or-later (see [LICENSE](LICENSE)).
