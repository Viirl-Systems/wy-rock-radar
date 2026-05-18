import {
  AlertTriangle,
  ArrowDownToLine,
  BookOpen,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Database,
  ExternalLink,
  Filter,
  Flag,
  Layers,
  MapPinned,
  Mountain,
  Navigation,
  NotebookPen,
  Route,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { DATA_SOURCES, HOTSPOTS, MATERIALS } from './data';
import { calculateRockScore, explainScore, getScoreBand, getScoreTone } from './scoring';
import type { FieldLog, Hotspot, LayerToggleState, Material } from './types';

const STORAGE_KEY = 'wy-rock-radar-field-logs';

const WY_BOUNDS = {
  minLat: 40.95,
  maxLat: 45.08,
  minLng: -111.12,
  maxLng: -104.02,
};

const GEOLOGY_AREAS = [
  {
    id: 'basin-silica',
    label: 'Basin silica / terrace search',
    tone: 'sage',
    points: [
      [-110.7, 41.25],
      [-108.1, 41.15],
      [-107.1, 42.12],
      [-108.4, 42.9],
      [-110.2, 42.58],
    ],
  },
  {
    id: 'crystalline-core',
    label: 'Crystalline uplift context',
    tone: 'violet',
    points: [
      [-109.2, 42.05],
      [-107.7, 42.12],
      [-107.08, 43.05],
      [-108.58, 43.46],
      [-109.55, 42.82],
    ],
  },
  {
    id: 'northern-uplift',
    label: 'Foothill quartz windows',
    tone: 'blue',
    points: [
      [-108.7, 43.62],
      [-106.92, 43.7],
      [-106.32, 44.52],
      [-108.15, 44.78],
      [-109.0, 44.28],
    ],
  },
  {
    id: 'east-private-risk',
    label: 'Access-constrained research',
    tone: 'copper',
    points: [
      [-105.55, 41.35],
      [-104.42, 41.38],
      [-104.33, 43.12],
      [-105.8, 43.02],
      [-106.18, 42.06],
    ],
  },
];

const PUBLIC_LAND_AREAS = [
  [
    [-110.92, 41.18],
    [-108.0, 41.18],
    [-108.16, 42.42],
    [-110.52, 42.34],
  ],
  [
    [-108.52, 41.55],
    [-106.02, 41.52],
    [-106.24, 42.6],
    [-108.1, 42.7],
  ],
  [
    [-107.22, 43.28],
    [-105.32, 43.14],
    [-105.62, 44.2],
    [-107.46, 44.1],
  ],
];

const CLAIM_AREAS = [
  [
    [-109.24, 42.08],
    [-108.36, 42.04],
    [-108.44, 42.68],
    [-109.08, 42.72],
  ],
  [
    [-107.08, 41.92],
    [-106.54, 41.98],
    [-106.58, 42.38],
    [-107.2, 42.3],
  ],
];

const ROAD_LINES = [
  [
    [-111.0, 41.62],
    [-109.15, 41.58],
    [-107.92, 41.68],
    [-106.84, 41.76],
    [-104.12, 41.18],
  ],
  [
    [-108.8, 42.44],
    [-107.55, 42.76],
    [-106.06, 42.34],
    [-104.78, 42.43],
  ],
  [
    [-107.9, 44.32],
    [-106.2, 44.08],
    [-105.25, 43.48],
  ],
];

const initialLayerState: LayerToggleState = {
  geology: true,
  publicLand: true,
  claims: true,
  roads: true,
  notes: true,
};

function projectPoint(lng: number, lat: number) {
  const x = ((lng - WY_BOUNDS.minLng) / (WY_BOUNDS.maxLng - WY_BOUNDS.minLng)) * 1000;
  const y = (1 - (lat - WY_BOUNDS.minLat) / (WY_BOUNDS.maxLat - WY_BOUNDS.minLat)) * 660;

  return { x, y };
}

function polygonPoints(points: number[][]) {
  return points.map(([lng, lat]) => {
    const { x, y } = projectPoint(lng, lat);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
}

function pathFromLine(points: number[][]) {
  return points
    .map(([lng, lat], index) => {
      const { x, y } = projectPoint(lng, lat);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readStoredLogs(): FieldLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FieldLog[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [selectedId, setSelectedId] = useState(HOTSPOTS[0].id);
  const [selectedMaterials, setSelectedMaterials] = useState<Material[]>(['Agate', 'Jasper', 'Jade', 'Petrified wood']);
  const [accessFilter, setAccessFilter] = useState('All');
  const [minimumScore, setMinimumScore] = useState(45);
  const [query, setQuery] = useState('');
  const [layers, setLayers] = useState<LayerToggleState>(initialLayerState);
  const [logs, setLogs] = useState<FieldLog[]>([]);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [fieldDraft, setFieldDraft] = useState({
    materialGuess: 'Unknown' as FieldLog['materialGuess'],
    quality: 3,
    quantity: 'Unknown' as FieldLog['quantity'],
    returnWorthy: true,
    notes: '',
  });

  useEffect(() => {
    setLogs(readStoredLogs());
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }, [logs]);

  const scoredHotspots = useMemo(
    () =>
      HOTSPOTS.map((hotspot) => ({
        hotspot,
        score: calculateRockScore(hotspot.scoreFactors),
        band: getScoreBand(hotspot),
      })).sort((a, b) => b.score - a.score),
    [],
  );

  const filteredHotspots = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return scoredHotspots.filter(({ hotspot, score }) => {
      const materialMatch =
        selectedMaterials.length === 0 || hotspot.targetMaterials.some((material) => selectedMaterials.includes(material));
      const accessMatch = accessFilter === 'All' || hotspot.accessStatus === accessFilter;
      const scoreMatch = score >= minimumScore || hotspot.accessStatus === 'Restricted / no-go';
      const queryMatch =
        !normalizedQuery ||
        [hotspot.name, hotspot.county, hotspot.geologyUnit, hotspot.landManager, ...hotspot.targetMaterials]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);

      return materialMatch && accessMatch && scoreMatch && queryMatch;
    });
  }, [accessFilter, minimumScore, query, scoredHotspots, selectedMaterials]);

  const selected = useMemo(() => {
    return scoredHotspots.find(({ hotspot }) => hotspot.id === selectedId) ?? scoredHotspots[0];
  }, [scoredHotspots, selectedId]);

  const selectedLogs = logs.filter((log) => log.hotspotId === selected.hotspot.id);

  const metrics = useMemo(() => {
    const priority = scoredHotspots.filter(({ score, hotspot }) => score >= 80 && hotspot.accessStatus !== 'Restricted / no-go').length;
    const verify = scoredHotspots.filter(({ hotspot }) => hotspot.accessStatus === 'Verify access').length;
    const average = Math.round(scoredHotspots.reduce((sum, item) => sum + item.score, 0) / scoredHotspots.length);
    const noGo = scoredHotspots.filter(({ hotspot }) => hotspot.accessStatus === 'Restricted / no-go').length;

    return { priority, verify, average, noGo };
  }, [scoredHotspots]);

  function toggleMaterial(material: Material) {
    setSelectedMaterials((current) =>
      current.includes(material) ? current.filter((item) => item !== material) : [...current, material],
    );
  }

  function toggleLayer(layer: keyof LayerToggleState) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  }

  function addFieldLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newLog: FieldLog = {
      id: crypto.randomUUID(),
      hotspotId: selected.hotspot.id,
      date: new Date().toISOString(),
      materialGuess: fieldDraft.materialGuess,
      quality: fieldDraft.quality,
      quantity: fieldDraft.quantity,
      returnWorthy: fieldDraft.returnWorthy,
      notes: fieldDraft.notes.trim(),
    };

    setLogs((current) => [newLog, ...current]);
    setFieldDraft({
      materialGuess: 'Unknown',
      quality: 3,
      quantity: 'Unknown',
      returnWorthy: true,
      notes: '',
    });
    setIsLogOpen(false);
  }

  function exportCsv() {
    const rows = [
      [
        'Hotspot',
        'County',
        'Score',
        'Band',
        'Access',
        'Claim risk',
        'Materials',
        'Geology',
        'Log date',
        'Material guess',
        'Quality',
        'Return worthy',
        'Notes',
      ],
      ...scoredHotspots.flatMap(({ hotspot, score, band }) => {
        const hotspotLogs = logs.filter((log) => log.hotspotId === hotspot.id);

        if (!hotspotLogs.length) {
          return [
            [
              hotspot.name,
              hotspot.county,
              score,
              band,
              hotspot.accessStatus,
              hotspot.claimRisk,
              hotspot.targetMaterials.join('; '),
              hotspot.geologyUnit,
              '',
              '',
              '',
              '',
              '',
            ],
          ];
        }

        return hotspotLogs.map((log) => [
          hotspot.name,
          hotspot.county,
          score,
          band,
          hotspot.accessStatus,
          hotspot.claimRisk,
          hotspot.targetMaterials.join('; '),
          hotspot.geologyUnit,
          formatDate(log.date),
          log.materialGuess,
          log.quality,
          log.returnWorthy ? 'yes' : 'no',
          log.notes,
        ]);
      }),
    ];

    downloadFile('wy-rock-radar-field-log.csv', rows.map((row) => row.map(csvEscape).join(',')).join('\n'), 'text/csv');
  }

  function exportGeoJson() {
    const features = scoredHotspots.map(({ hotspot, score, band }) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [hotspot.lng, hotspot.lat],
      },
      properties: {
        id: hotspot.id,
        name: hotspot.name,
        county: hotspot.county,
        score,
        band,
        accessStatus: hotspot.accessStatus,
        claimRisk: hotspot.claimRisk,
        targetMaterials: hotspot.targetMaterials,
        geologyUnit: hotspot.geologyUnit,
        fieldLogs: logs.filter((log) => log.hotspotId === hotspot.id),
      },
    }));

    downloadFile(
      'wy-rock-radar-hotspots.geojson',
      JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
      'application/geo+json',
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Rockhounding filters">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Mountain size={22} />
          </div>
          <div>
            <p className="eyeline">Personal Wyoming model</p>
            <h1>WY Rock Radar</h1>
          </div>
        </div>

        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search county, rock, geology"
            aria-label="Search hotspots"
          />
        </label>

        <section className="filter-block" aria-labelledby="target-materials">
          <div className="section-title">
            <Filter size={15} />
            <h2 id="target-materials">Targets</h2>
          </div>
          <div className="material-grid">
            {MATERIALS.map((material) => (
              <button
                key={material}
                className={`chip ${selectedMaterials.includes(material) ? 'is-selected' : ''}`}
                type="button"
                onClick={() => toggleMaterial(material)}
              >
                {material}
              </button>
            ))}
          </div>
        </section>

        <section className="filter-block" aria-labelledby="confidence-filter">
          <div className="section-title">
            <SlidersHorizontal size={15} />
            <h2 id="confidence-filter">Decision Filters</h2>
          </div>
          <label className="range-field">
            <span>Minimum score</span>
            <strong>{minimumScore}</strong>
            <input
              min="0"
              max="100"
              step="5"
              type="range"
              value={minimumScore}
              onChange={(event) => setMinimumScore(Number(event.target.value))}
            />
          </label>
          <label className="select-field">
            <span>Access status</span>
            <select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}>
              <option>All</option>
              <option>Likely public</option>
              <option>Verify access</option>
              <option>Private risk</option>
              <option>Restricted / no-go</option>
            </select>
          </label>
        </section>

        <section className="filter-block" aria-labelledby="layer-controls">
          <div className="section-title">
            <Layers size={15} />
            <h2 id="layer-controls">Map Layers</h2>
          </div>
          <div className="toggle-list">
            {Object.entries(layers).map(([key, value]) => (
              <label key={key} className="toggle-row">
                <span>{key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`)}</span>
                <input
                  checked={value}
                  type="checkbox"
                  onChange={() => toggleLayer(key as keyof LayerToggleState)}
                />
              </label>
            ))}
          </div>
        </section>

        <div className="legal-callout">
          <ShieldAlert size={18} />
          <p>
            Scores are trip-planning signals only. Verify land ownership, active claims, local rules, and fossil restrictions
            before collecting.
          </p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyeline">Wyoming-only rockhounding research system</p>
            <h2>Candidate zones ranked by geology, access, claims, routes, and field history</h2>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" onClick={exportGeoJson}>
              <ArrowDownToLine size={16} />
              GeoJSON
            </button>
            <button className="primary-button" type="button" onClick={exportCsv}>
              <ArrowDownToLine size={16} />
              Export CSV
            </button>
          </div>
        </header>

        <section className="metric-strip" aria-label="Model metrics">
          <Metric icon={<Flag size={17} />} label="Priority zones" value={metrics.priority} />
          <Metric icon={<Navigation size={17} />} label="Access checks" value={metrics.verify} />
          <Metric icon={<CircleDot size={17} />} label="Average score" value={metrics.average} />
          <Metric icon={<AlertTriangle size={17} />} label="No-go examples" value={metrics.noGo} />
        </section>

        <div className="main-grid">
          <section className="map-panel" aria-label="Wyoming rockhounding map">
            <div className="panel-heading">
              <div>
                <p className="eyeline">Operational map</p>
                <h2>Potential zones and risk overlays</h2>
              </div>
              <span>{filteredHotspots.length} visible</span>
            </div>

            <WyomingMap
              filteredHotspots={filteredHotspots.map((item) => item.hotspot)}
              layers={layers}
              selectedId={selected.hotspot.id}
              onSelect={setSelectedId}
            />

            <div className="legend" aria-label="Map legend">
              <span>
                <i className="legend-dot hot" /> Priority
              </span>
              <span>
                <i className="legend-dot good" /> Promising
              </span>
              <span>
                <i className="legend-dot watch" /> Research
              </span>
              <span>
                <i className="legend-line" /> Roads
              </span>
              <span>
                <i className="legend-claim" /> Claim risk
              </span>
            </div>
          </section>

          <aside className="inspector" aria-label="Selected hotspot details">
            <Inspector
              hotspot={selected.hotspot}
              score={selected.score}
              logs={selectedLogs}
              onOpenLog={() => setIsLogOpen(true)}
            />
          </aside>
        </div>

        <section className="bottom-grid">
          <RankedList
            items={filteredHotspots}
            selectedId={selected.hotspot.id}
            onSelect={setSelectedId}
          />
          <SourcePanel />
        </section>
      </section>

      {isLogOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="log-modal" onSubmit={addFieldLog}>
            <div className="modal-heading">
              <div>
                <p className="eyeline">Field log</p>
                <h2>{selected.hotspot.name}</h2>
              </div>
              <button aria-label="Close field log" className="icon-button" type="button" onClick={() => setIsLogOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="form-grid">
              <label>
                Material guess
                <select
                  value={fieldDraft.materialGuess}
                  onChange={(event) =>
                    setFieldDraft((current) => ({
                      ...current,
                      materialGuess: event.target.value as FieldLog['materialGuess'],
                    }))
                  }
                >
                  <option>Unknown</option>
                  {MATERIALS.map((material) => (
                    <option key={material}>{material}</option>
                  ))}
                </select>
              </label>
              <label>
                Quality
                <input
                  min="1"
                  max="5"
                  type="number"
                  value={fieldDraft.quality}
                  onChange={(event) =>
                    setFieldDraft((current) => ({ ...current, quality: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                Quantity
                <select
                  value={fieldDraft.quantity}
                  onChange={(event) =>
                    setFieldDraft((current) => ({ ...current, quantity: event.target.value as FieldLog['quantity'] }))
                  }
                >
                  <option>Unknown</option>
                  <option>Trace</option>
                  <option>Small pocket</option>
                  <option>Productive</option>
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  checked={fieldDraft.returnWorthy}
                  type="checkbox"
                  onChange={(event) =>
                    setFieldDraft((current) => ({ ...current, returnWorthy: event.target.checked }))
                  }
                />
                Worth returning
              </label>
            </div>

            <label className="notes-field">
              Notes
              <textarea
                value={fieldDraft.notes}
                onChange={(event) => setFieldDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Access condition, actual material, road status, confidence, next pass."
              />
            </label>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setIsLogOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                <NotebookPen size={16} />
                Save log
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function WyomingMap({
  filteredHotspots,
  layers,
  selectedId,
  onSelect,
}: {
  filteredHotspots: Hotspot[];
  layers: LayerToggleState;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const visibleIds = new Set(filteredHotspots.map((hotspot) => hotspot.id));

  return (
    <div className="map-canvas">
      <svg viewBox="0 0 1000 660" role="img" aria-label="Wyoming candidate hotspot map">
        <defs>
          <pattern id="grid" width="46" height="46" patternUnits="userSpaceOnUse">
            <path d="M 46 0 L 0 0 0 46" fill="none" stroke="rgba(40, 54, 45, .08)" strokeWidth="1" />
          </pattern>
          <filter id="pinShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#0f1712" floodOpacity="0.23" />
          </filter>
        </defs>

        <rect width="1000" height="660" rx="18" fill="#eff1e7" />
        <rect width="1000" height="660" fill="url(#grid)" />
        <path
          d="M 35 32 L 964 22 L 956 628 L 44 620 Z"
          fill="#f8f3e8"
          stroke="#34443b"
          strokeWidth="3"
        />
        <path
          d="M 35 32 L 964 22 L 956 628 L 44 620 Z"
          fill="none"
          stroke="rgba(255,255,255,.65)"
          strokeWidth="7"
        />

        {layers.geology &&
          GEOLOGY_AREAS.map((area) => (
            <g key={area.id}>
              <polygon className={`geo-area ${area.tone}`} points={polygonPoints(area.points).join(' ')} />
              <text className="map-label" x={polygonPoints(area.points)[0].split(',')[0]} y={polygonPoints(area.points)[0].split(',')[1]}>
                {area.label}
              </text>
            </g>
          ))}

        {layers.publicLand &&
          PUBLIC_LAND_AREAS.map((area, index) => (
            <polygon key={index} className="public-land-area" points={polygonPoints(area).join(' ')} />
          ))}

        {layers.claims &&
          CLAIM_AREAS.map((area, index) => (
            <polygon key={index} className="claim-area" points={polygonPoints(area).join(' ')} />
          ))}

        {layers.roads &&
          ROAD_LINES.map((line, index) => (
            <path key={index} className="road-line" d={pathFromLine(line)} />
          ))}

        {HOTSPOTS.map((hotspot) => {
          const point = projectPoint(hotspot.lng, hotspot.lat);
          const score = calculateRockScore(hotspot.scoreFactors);
          const tone = hotspot.accessStatus === 'Restricted / no-go' ? 'blocked' : getScoreTone(score);
          const visible = visibleIds.has(hotspot.id);
          const isSelected = hotspot.id === selectedId;

          return (
            <g
              key={hotspot.id}
              className={`map-pin ${tone} ${visible ? '' : 'is-muted'} ${isSelected ? 'is-selected' : ''}`}
              filter="url(#pinShadow)"
              onClick={() => onSelect(hotspot.id)}
              tabIndex={0}
              role="button"
              aria-label={`Select ${hotspot.name}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(hotspot.id);
              }}
            >
              <circle cx={point.x} cy={point.y} r={isSelected ? 18 : 13} />
              <circle cx={point.x} cy={point.y} r="5" className="pin-core" />
              <text x={point.x + 18} y={point.y - 18}>
                {score}
              </text>
            </g>
          );
        })}

        <text x="62" y="594" className="state-label">
          WYOMING
        </text>
      </svg>
    </div>
  );
}

function Inspector({
  hotspot,
  score,
  logs,
  onOpenLog,
}: {
  hotspot: Hotspot;
  score: number;
  logs: FieldLog[];
  onOpenLog: () => void;
}) {
  const band = getScoreBand(hotspot);
  const scoreTone = hotspot.accessStatus === 'Restricted / no-go' ? 'blocked' : getScoreTone(score);

  return (
    <div className="inspector-content">
      <div className="score-header">
        <div>
          <p className="eyeline">{hotspot.county}</p>
          <h2>{hotspot.name}</h2>
        </div>
        <div className={`score-dial ${scoreTone}`}>
          <span>{score}</span>
          <small>{band}</small>
        </div>
      </div>

      <div className="tag-row">
        {hotspot.targetMaterials.map((material) => (
          <span key={material}>{material}</span>
        ))}
      </div>

      <div className="detail-stack">
        <DetailRow icon={<Mountain size={16} />} label="Geology" value={hotspot.geologyUnit} />
        <DetailRow icon={<MapPinned size={16} />} label="Land manager" value={hotspot.landManager} />
        <DetailRow icon={<Navigation size={16} />} label="Access" value={hotspot.accessStatus} />
        <DetailRow icon={<AlertTriangle size={16} />} label="Claim risk" value={hotspot.claimRisk} />
        <DetailRow icon={<Route size={16} />} label="Roads" value={hotspot.roadProximity} />
      </div>

      <section className="inspector-section">
        <h3>Why it scores here</h3>
        <ul className="clean-list">
          {explainScore(hotspot.scoreFactors).map((note) => (
            <li key={note}>
              <CheckCircle2 size={15} />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="inspector-section warning-section">
        <h3>Pre-trip guardrails</h3>
        <ul className="clean-list">
          {hotspot.cautions.map((caution) => (
            <li key={caution}>
              <ShieldAlert size={15} />
              <span>{caution}</span>
            </li>
          ))}
        </ul>
      </section>

      <button className="primary-button full-width" type="button" onClick={onOpenLog}>
        <NotebookPen size={16} />
        Add field log
      </button>

      <section className="inspector-section">
        <h3>Field history</h3>
        {logs.length ? (
          <div className="log-list">
            {logs.slice(0, 3).map((log) => (
              <article key={log.id} className="log-row">
                <div>
                  <strong>{log.materialGuess}</strong>
                  <span>{formatDate(log.date)} · quality {log.quality}/5</span>
                </div>
                <em>{log.returnWorthy ? 'Return' : 'Skip'}</em>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">No field notes yet. First visit should validate access, float, road condition, and return value.</p>
        )}
      </section>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="detail-row">
      <div className="detail-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function RankedList({
  items,
  selectedId,
  onSelect,
}: {
  items: Array<{ hotspot: Hotspot; score: number; band: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="ranked-panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyeline">Ranked queue</p>
          <h2>Next scout list</h2>
        </div>
        <ClipboardCheck size={18} />
      </div>
      <div className="ranked-list">
        {items.map(({ hotspot, score, band }, index) => (
          <button
            key={hotspot.id}
            className={`ranked-row ${hotspot.id === selectedId ? 'is-selected' : ''}`}
            type="button"
            onClick={() => onSelect(hotspot.id)}
          >
            <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="rank-main">
              <strong>{hotspot.name}</strong>
              <em>
                {hotspot.county} · {hotspot.targetMaterials.slice(0, 3).join(', ')}
              </em>
            </span>
            <span className={`rank-score ${getScoreTone(score)}`}>{score}</span>
            <span className="rank-band">{band}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SourcePanel() {
  return (
    <section className="source-panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyeline">Handoff system</p>
          <h2>Free data roadmap</h2>
        </div>
        <Database size={18} />
      </div>
      <div className="source-list">
        {DATA_SOURCES.map((source) => (
          <a key={source.name} href={source.url} target="_blank" rel="noreferrer">
            <BookOpen size={16} />
            <span>
              <strong>{source.name}</strong>
              <em>{source.use}</em>
            </span>
            <ExternalLink size={14} />
          </a>
        ))}
      </div>
    </section>
  );
}
