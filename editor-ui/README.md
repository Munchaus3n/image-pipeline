# Cutout Studio Browser UI

This is the Vite frontend for the Cutout Studio terminal/browser workflow.

Install dependencies:

```powershell
npm install
```

Run the development server:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

Build for validation:

```powershell
npm run build
npm run lint
```

The UI expects the local API to be running at `http://127.0.0.1:7421`.
