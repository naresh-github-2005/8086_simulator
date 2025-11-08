
# 8086 Emulator / Simulator (React + JavaScript)

A small 8086 CPU emulator/simulator implemented as a React single-page app.
This repository contains the front-end UI, example assembly programs, and memory/CPU emulation code written in JavaScript.

This README describes how to run the project locally, the code layout, and how to add or run example programs.

## Features

- Simple 8086 instruction stepping and memory inspection (implemented in JS files under `src/`).
- Example programs in `src/examples/` (AddSub, Fibonacci, MultiDivi, Average, etc.).
- A minimal React UI to load, run, and inspect programs in the browser.

## Prerequisites

- Node.js (16+ recommended) and npm installed.

On Windows PowerShell, verify with:

```powershell
node -v
npm -v
```

## Install

Clone the repo and install dependencies:

```powershell
# from the repo root
npm install
```

## Run (development)

Start the dev server (Create React App):

```powershell
npm start
```

Open http://localhost:3000 in your browser. The app will hot-reload on change.

## Build (production)

Create an optimized production build:

```powershell
npm run build
```

The build output will be placed in the `build/` folder.

## Tests

Run the unit tests (CRA/jest):

```powershell
npm test
```

There is a basic test harness in `src/App.test.js` created by Create React App.

## Project layout

- `public/` — static HTML and metadata.
- `src/` — main application source code.
	- `App.js` — main React app component.
	- `index.js` — React entrypoint.
	- `memory0000-1000code.js`, `normalMemory.js` — memory-related emulator code.
	- `DEC_ISSUE.js`, `decimal_Hex_issue`, `EG1.js`, `EG2.js`, `EG3_loopError_cmpError.js`, `EG4_Factotial_llop_error.js` — example/emulation code and experiments.
	- `examples/` — plain text example programs you can load into the emulator.

## Using the examples

The `src/examples/` directory contains several text files with simple programs (Add/Sub, Fibonacci, etc.). Open the app in the browser and use the UI to load an example, then step through instructions or run until completion.

If you want to add a new example, place a `.txt` program file in `src/examples/` and update any UI lists (if applicable) to surface the new example.

## Development notes

- The emulator is implemented in plain JavaScript for clarity; expect opportunity to refactor into a cleaner architecture (separate CPU, memory, and UI layers).
- If you add features (breakpoints, registers view, full assembler), prefer small PRs with one feature at a time.

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`.
3. Make changes and add tests where appropriate.
4. Open a pull request describing your change.

Please keep changes small and focused.

## Known issues

- This project started from a Create React App template; the emulator code and examples are exploratory and may contain logic or formatting bugs.
- Some example files are named with typos (e.g., `EG4_Factotial_llop_error.js`) — renaming is safe but please preserve history or open an issue first.

## License

This project does not include a license file. Add a `LICENSE` if you want to specify reuse terms (e.g., MIT).

## Contact

For questions or help, open an issue in this repository.

---

Note: If you'd like, I can also:

- Add a short demo GIF or screenshot to the README.
- Add basic instructions in the app UI to load example programs.
- Create a CONTRIBUTING.md and LICENSE file.

