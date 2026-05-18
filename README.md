# WY Rock Radar

WY Rock Radar is a personal Wyoming rockhounding research dashboard. It helps Gwen rank candidate zones by geology, mineral evidence, public-land/access confidence, mining-claim risk, road proximity, terrain, and her own field history.

This is intentionally built as a free, handoff-ready MVP:

- React + Vite frontend
- MapLibre map canvas with free OpenStreetMap raster tiles
- No paid map key
- No app database; field data remains local-first
- Local browser field logs
- CSV and GeoJSON export
- Vercel-ready static deployment
- Vercel cron endpoint for monitoring Rockhounding.org Wyoming community-pin changes

## Best Path

Use this app as the interface and decision model, not as a guarantee engine. The right workflow is:

1. Start with the seeded Wyoming candidate zones.
2. Replace or improve the mock overlay geometry with official GIS exports from QGIS.
3. Field-test the highest-priority zones.
4. Log actual finds, access conditions, and road quality.
5. Adjust the scoring model based on reality.

## Local Setup

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

## Product Scope

Current MVP:

- Wyoming-only rockhounding dashboard
- Candidate hotspot scoring
- Expanded material filters, including kimberlite/diamond indicators, pegmatite minerals, copper indicators, opal/chalcedony, fossils/uranium cautions, and common Wyoming collector targets
- Access-status filter
- Layer toggles for geology, public land, claim risk, roads, community reference sites, and notes
- Selected hotspot inspector
- Legal/access cautions
- Local field log
- CSV export
- GeoJSON export
- Free data-source roadmap
- Daily `/api/rockhounding-sync` source monitor configured in `vercel.json`

Out of scope for v1:

- User accounts
- Cloud sync
- Paid tile services
- AI rock identification
- Real-time claim validation
- Automated route navigation

## Scoring Model

The current score is transparent and intentionally simple:

```text
Rock Score =
  geology * 8
+ mineralEvidence * 5
+ access * 5
+ roadProximity * 3
+ personalHistory * 2
- claimPenalty * 5
- terrainPenalty
```

Each input should be treated as a planning signal, not a legal or geological guarantee.

## Data Sources To Upgrade First

Primary source roadmap:

- Wyoming State Geological Survey GIS: https://main.wsgs.wyo.gov/gis
- WSGS Diamonds: https://main.wsgs.wyo.gov/mineral-resources/gemstones/diamonds
- WSGS Rock Hunting Suggestions for Wyoming: https://www.wsgs.wyo.gov/products/wsgs-1973-mp-121.pdf
- USGS Mineral Resources Data: https://www.usgs.gov/programs/mineral-resources-program/mineral-resources-data
- USGS Front Range Kimberlite Studies: https://www.usgs.gov/publications/minor-and-trace-element-contents-kimberlites-front-range-colorado-and-wyoming
- BLM Wyoming Surface Management Agency: https://gis.blm.gov/wyarcgis/rest/services/Lands/BLM_WY_Surface_Management_Agency/MapServer
- BLM MLRS Mining Claims: https://gis.blm.gov/nlsdb/rest/services/HUB/BLM_Natl_MLRS_Mining_Claims_Not_Closed/MapServer
- BLM Wyoming Rockhounding Guide: https://www.blm.gov/documents/wyoming/public-room/brochure/wyoming-rockhounding-guide
- Rockhounding.org Wyoming Community Map: https://rockhounding.org/maps/us/wyoming

## Scheduled Source Monitor

The production deployment calls `/api/rockhounding-sync` daily at 14:00 UTC. The endpoint fetches the Rockhounding.org Wyoming map, parses the public pin payload, compares it to the committed baseline, and returns new, removed, or changed community locations.

For stricter production auth, set `CRON_SECRET` in Vercel. When present, the endpoint requires:

```text
Authorization: Bearer $CRON_SECRET
```

This first pass is a read-only monitor. It does not write to a database yet; the next production step is to store sync snapshots in Postgres or another durable store and surface a "new source locations" review queue in the app.

Recommended GIS workflow:

1. Download or connect to the official layers in QGIS.
2. Clip layers to Wyoming.
3. Simplify geometry for web performance.
4. Export small layers as GeoJSON for early versions.
5. Convert large layers to PMTiles later.
6. Replace the prototype SVG overlay arrays in `src/App.tsx` with generated data files.

## Legal And Field Use Notes

The app should always preserve these rules:

- Public land does not automatically mean collecting is allowed.
- Active mining claims require verification.
- Private land requires permission.
- Vertebrate fossils and cultural artifacts are not personal collecting targets.
- Petrified wood has personal-use limits under BLM guidance.
- Local BLM, Forest Service, state, county, and special-management rules can override general assumptions.

## Handoff Notes

Important files:

- `src/data.ts`: candidate zones, material list, official data-source links
- `src/data/rockhounding-wyoming-baseline.json`: Rockhounding.org Wyoming community-pin baseline for reference pins and change monitoring
- `src/scoring.ts`: scoring model and score-band logic
- `src/App.tsx`: dashboard UI, map prototype, filters, field logs, exports
- `src/styles.css`: full visual system and responsive layout
- `api/rockhounding-sync.mjs`: Vercel cron-compatible source monitor
- `vercel.json`: daily Vercel cron schedule

The project is ready to hand to Gwen as a working product prototype plus a clear path to real GIS-grade data.
