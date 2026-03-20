# medical-ui Dependency Report

Date: 2026-03-10
Scope: `frontend/medical-ui/package.json` vs imports in `frontend/medical-ui/src`

## 1. Declared Dependencies

- `@react-three/drei`
- `@react-three/fiber`
- `@testing-library/dom`
- `@testing-library/jest-dom`
- `@testing-library/react`
- `@testing-library/user-event`
- `@types/three`
- `axios`
- `html2canvas`
- `jspdf`
- `lucide-react`
- `react`
- `react-dom`
- `react-router-dom`
- `react-scripts`
- `three`
- `web-vitals`

## 2. Actually Imported In Source

- `react`
- `react-dom`
- `@react-three/fiber`
- `@react-three/drei`
- `three`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `web-vitals` (dynamic import in `src/reportWebVitals.js`)

## 3. Declared But Not Imported In Current Source

- `@testing-library/dom`
- `@testing-library/user-event`
- `@types/three`
- `axios`
- `html2canvas`
- `jspdf`
- `lucide-react`
- `react-router-dom`

## 4. Tooling Dependency

- `react-scripts` is not imported directly in source and is expected in CRA projects. It powers `start`, `build`, and `test` scripts.

## 5. Suggested Cleanup Options

1. Keep all current dependencies if upcoming features will use PDF export, router, and icon packs.
2. Remove currently unused dependencies to reduce install size and lockfile churn.
3. Move test-only packages to `devDependencies` if you are not constrained by CRA defaults.
