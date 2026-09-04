# Running the preview

## How to run the server

```
npm run dev
```

- Vite dev server; serves the app at the default port **5173**
  (http://localhost:5173/). If 5173 is taken, Vite auto-increments the port
  — pick the next free one from its startup log.
- Detached start (Windows):
  ```powershell
  powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory '<repo>' -RedirectStandardOutput '<repo>\.freebuff\preview-<id>.log' -RedirectStandardError '<repo>\.freebuff\preview-<id>.log.err' -WindowStyle Hidden -PassThru).Id"
  ```
  stdout and stderr must go to DIFFERENT files (`npm.cmd` must be named
  exactly; Start-Process does not resolve shell shims).
- Check it is up: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` → `200`.
  Find the serving node PID via `netstat -ano | grep 5173` (the OwningProcess
  is the `node ... vite/bin/vite.js` process).

## Reproducing uncommitted artifacts

- No env files are required (this project has no `.env*`).
- Dependencies are already installed in `node_modules`; if missing:
  `npm install` (package-lock.json is committed).
- Note: the repository currently contains uncommitted calendar-feature work
  (see `git status`). The dev server serves the source directly, so no build
  step or artifact reproduction is needed.

## Notes

- `npm run build` produces `dist/`; preview of the built app uses
  `npm run preview` (port 4173). Not required for the live dev preview.