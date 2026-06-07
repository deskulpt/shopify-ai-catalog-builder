---
phase: 01-hello-world-service-architecture
plan: 01
subsystem: "scaffolding"
tags:
  - shopify-app
  - python-service
  - markitdown
provides:
  - "Hello World landing page with Polaris web components"
  - "Flask microservice running on port 5005"
affects: []
tech-stack:
  added:
    - "@shopify/shopify-app-react-router"
    - "markitdown"
    - "flask"
  patterns:
    - "Flask microservice for python packages proxying to Node.js backend"
key-files:
  created:
    - "services/markitdown_service.py"
  modified:
    - "app/routes/app._index.tsx"
key-decisions:
  - "Use Python 3.11 for MarkItDown to satisfy Python 3.10+ requirement"
  - "Default Flask service to port 5005 to avoid macOS AirPlay Port 5000 conflict"
patterns-established:
  - "Microservice communication on port 5005"
duration: "45min"
completed: 2026-06-07
---

# Phase 1 Plan 01: Hello World & Service Architecture Summary

**Scaffolded the React Router Shopify embedded app shell and set up the Flask Python microservice utilizing Microsoft MarkItDown on port 5005.**

## Performance

- **Duration:** 45min
- **Tasks:** 5 completed
- **Files modified:** 3 modified/created

## Accomplishments

- Scaffolded the React Router + Node.js Shopify app at the root of the workspace.
- Configured a Python 3.11 virtual environment and successfully installed the Microsoft `markitdown` library and dependencies.
- Created `services/markitdown_service.py` to expose `/health`, `/convert`, and `/convert-url` routes on port 5005 (avoiding macOS port 5000 Control Center conflict).
- Replaced default Shopify template landing page with a custom Product Ingest AI Hello World dashboard that pings the Python service during loader execution and displays connection status.

## Task Commits

1. **Task 1: Scaffold Shopify App** - `5011e67`
2. **Task 4: Write Flask microservice** - `bf4be88`

## Files Created/Modified

- `services/markitdown_service.py` - Flask web server providing the MarkItDown API.
- `app/routes/app._index.tsx` - Root app route rendering the Polaris Web Components dashboard.
- `package.json` - Node dependencies and scripts.

## Decisions & Deviations

- **Port Modification:** Shifted the Python service port from `5000` to `5005` to prevent conflicts with macOS default AirPlay Receiver bindings.
- **Python Version:** Recreated virtual environment using Python 3.11 since Microsoft `markitdown` is incompatible with Python 3.9 (default on the system).

## Next Phase Readiness

- The service architecture is fully validated and verified.
- The next phase, **Phase 2: Ingestion & Conversion**, can proceed with building the ingestion forms and web crawler discovery tools.
