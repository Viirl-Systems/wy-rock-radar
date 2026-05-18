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
  LoaderCircle,
  MapPinned,
  Mountain,
  Navigation,
  NotebookPen,
  Plus,
  Route,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type Marker,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { DATA_SOURCES, HOTSPOTS, MATERIALS } from './data';
import { calculateRockScore, explainScore, getScoreBand, getScoreTone } from './scoring';
import type { FieldLog, Hotspot, LayerToggleState, Material } from './types';

const STORAGE_KEY = 'wy-rock-radar-field-logs';
const CUSTOM_DATA_SOURCES_STORAGE_KEY = 'wy-rock-radar-custom-data-sources';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const MODEL_LAST_UPDATED = 'May 18, 2026';

const WY_BOUNDS = {
  minLat: 40.95,
  maxLat: 45.08,
  minLng: -111.12,
  maxLng: -104.02,
};

const WYOMING_CENTER: [number, number] = [-107.55, 42.92];
const WYOMING_MAX_BOUNDS: [[number, number], [number, number]] = [
  [WY_BOUNDS.minLng - 1, WY_BOUNDS.minLat - 0.75],
  [WY_BOUNDS.maxLng + 1, WY_BOUNDS.maxLat + 0.75],
];
const WYOMING_VIEWBOX = `${WY_BOUNDS.minLng},${WY_BOUNDS.maxLat},${WY_BOUNDS.maxLng},${WY_BOUNDS.minLat}`;

type BasemapId = 'street' | 'topo' | 'imagery' | 'hybrid';

const DEFAULT_BASEMAP_ID: BasemapId = 'hybrid';
const BASEMAP_OPTIONS: Array<{
  id: BasemapId;
  label: string;
  layerId: string;
  nativeZoom: number;
}> = [
  { id: 'hybrid', label: 'USGS aerial + topo', layerId: 'basemap-usgs-hybrid', nativeZoom: 16 },
  { id: 'imagery', label: 'USGS aerial', layerId: 'basemap-usgs-imagery', nativeZoom: 16 },
  { id: 'topo', label: 'USGS topo', layerId: 'basemap-usgs-topo', nativeZoom: 16 },
  { id: 'street', label: 'Street', layerId: 'basemap-street', nativeZoom: 19 },
];
const BASEMAP_LAYER_IDS = BASEMAP_OPTIONS.map((option) => option.layerId);

function getDefaultBasemapVisibility(id: BasemapId) {
  return id === DEFAULT_BASEMAP_ID ? 'visible' : 'none';
}

const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
    usgsTopo: {
      type: 'raster',
      tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'USGS The National Map',
    },
    usgsImagery: {
      type: 'raster',
      tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'USDA, USGS The National Map',
    },
    usgsHybrid: {
      type: 'raster',
      tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'USDA, USGS The National Map',
    },
  },
  layers: [
    {
      id: 'basemap-street',
      type: 'raster',
      source: 'osm',
      layout: {
        visibility: getDefaultBasemapVisibility('street'),
      },
      paint: {
        'raster-saturation': -0.42,
        'raster-contrast': -0.08,
        'raster-brightness-min': 0.12,
        'raster-brightness-max': 0.93,
      },
    },
    {
      id: 'basemap-usgs-topo',
      type: 'raster',
      source: 'usgsTopo',
      layout: {
        visibility: getDefaultBasemapVisibility('topo'),
      },
      paint: {
        'raster-saturation': -0.12,
        'raster-contrast': -0.04,
      },
    },
    {
      id: 'basemap-usgs-imagery',
      type: 'raster',
      source: 'usgsImagery',
      layout: {
        visibility: getDefaultBasemapVisibility('imagery'),
      },
      paint: {
        'raster-saturation': -0.08,
        'raster-contrast': -0.06,
        'raster-brightness-min': 0.04,
        'raster-brightness-max': 0.94,
      },
    },
    {
      id: 'basemap-usgs-hybrid',
      type: 'raster',
      source: 'usgsHybrid',
      layout: {
        visibility: getDefaultBasemapVisibility('hybrid'),
      },
      paint: {
        'raster-saturation': -0.06,
        'raster-contrast': -0.05,
        'raster-brightness-min': 0.04,
        'raster-brightness-max': 0.95,
      },
    },
  ],
};

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

type UserLocation = {
  label: string;
  lat: number;
  lng: number;
  source: 'address' | 'coordinates';
};

type NominatimSearchResult = {
  display_name?: string;
  lat: string;
  lon: string;
};

type DataSourceStatus = {
  name: string;
  status: string;
  detail: string;
  tone: 'connected' | 'local' | 'manual' | 'custom';
};

type CustomDataSource = {
  id: string;
  name: string;
  type: 'Reference' | 'Service/API' | 'Dataset' | 'Claim/access';
  url: string;
  notes: string;
  addedAt: string;
};

const DATA_SOURCE_STATUS: DataSourceStatus[] = [
  {
    name: 'OpenStreetMap tiles',
    status: 'Connected',
    detail: 'Street basemap context to zoom 19.',
    tone: 'connected',
  },
  {
    name: 'USGS National Map',
    status: 'Connected',
    detail: 'Topo and aerial basemaps for field-scale review.',
    tone: 'connected',
  },
  {
    name: 'Address lookup',
    status: 'Connected',
    detail: 'Nominatim geocoder, bounded to Wyoming.',
    tone: 'connected',
  },
  {
    name: 'Field logs',
    status: 'Local',
    detail: 'Saved in this browser until exported.',
    tone: 'local',
  },
  {
    name: 'WSGS / BLM references',
    status: 'Reference',
    detail: 'Linked for manual review; no auto-sync yet.',
    tone: 'manual',
  },
];

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

function isInsideWyoming(lat: number, lng: number) {
  return lat >= WY_BOUNDS.minLat && lat <= WY_BOUNDS.maxLat && lng >= WY_BOUNDS.minLng && lng <= WY_BOUNDS.maxLng;
}

function parseCoordinateSearch(value: string): UserLocation | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const asLatLng = isInsideWyoming(first, second);
  const asLngLat = isInsideWyoming(second, first);
  if (!asLatLng && !asLngLat) return null;

  const lat = asLatLng ? first : second;
  const lng = asLatLng ? second : first;

  return {
    label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    lat,
    lng,
    source: 'coordinates',
  };
}

function normalizeWyomingQuery(value: string) {
  return /\b(wy|wyo|wyoming)\b/i.test(value) ? value : `${value}, Wyoming`;
}

function shortenLocationLabel(value: string) {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.slice(0, 3).join(', ') || value;
}

function getDistanceMiles(from: Pick<UserLocation, 'lat' | 'lng'>, to: Pick<Hotspot, 'lat' | 'lng'>) {
  const earthRadiusMiles = 3958.8;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMiles * c;
}

function formatMiles(value: number) {
  if (value < 10) return `${value.toFixed(1)} mi`;
  return `${Math.round(value)} mi`;
}

function readStoredLogs(): FieldLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FieldLog[]) : [];
  } catch {
    return [];
  }
}

function readStoredCustomDataSources(): CustomDataSource[] {
  try {
    const raw = localStorage.getItem(CUSTOM_DATA_SOURCES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomDataSource[]) : [];
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
  const [addressQuery, setAddressQuery] = useState('');
  const [searchRadiusMiles, setSearchRadiusMiles] = useState(50);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [activeBasemap, setActiveBasemap] = useState<BasemapId>(DEFAULT_BASEMAP_ID);
  const [layers, setLayers] = useState<LayerToggleState>(initialLayerState);
  const [logs, setLogs] = useState<FieldLog[]>([]);
  const [customDataSources, setCustomDataSources] = useState<CustomDataSource[]>([]);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [fieldDraft, setFieldDraft] = useState({
    materialGuess: 'Unknown' as FieldLog['materialGuess'],
    quality: 3,
    quantity: 'Unknown' as FieldLog['quantity'],
    returnWorthy: true,
    notes: '',
  });
  const [dataSourceDraft, setDataSourceDraft] = useState({
    name: '',
    type: 'Reference' as CustomDataSource['type'],
    url: '',
    notes: '',
  });

  useEffect(() => {
    setLogs(readStoredLogs());
    setCustomDataSources(readStoredCustomDataSources());
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_DATA_SOURCES_STORAGE_KEY, JSON.stringify(customDataSources));
  }, [customDataSources]);

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

  const nearestHotspot = useMemo(() => {
    if (!userLocation) return null;

    return scoredHotspots
      .map((item) => ({
        ...item,
        distanceMiles: getDistanceMiles(userLocation, item.hotspot),
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)[0];
  }, [scoredHotspots, userLocation]);

  const hotspotsInsideRadius = useMemo(() => {
    if (!userLocation) return [];

    return scoredHotspots
      .map((item) => ({
        ...item,
        distanceMiles: getDistanceMiles(userLocation, item.hotspot),
      }))
      .filter((item) => item.distanceMiles <= searchRadiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);
  }, [scoredHotspots, searchRadiusMiles, userLocation]);

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

  function applyUserLocation(location: UserLocation) {
    const nearest = scoredHotspots
      .map((item) => ({
        ...item,
        distanceMiles: getDistanceMiles(location, item.hotspot),
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)[0];

    setUserLocation(location);
    if (nearest) {
      setSelectedId(nearest.hotspot.id);
    }
  }

  async function locateAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = addressQuery.trim();
    if (!trimmedQuery) {
      setLocationError('Add a Wyoming address, town, or coordinate pair.');
      return;
    }

    setIsGeocoding(true);
    setLocationError('');

    try {
      const coordinateLocation = parseCoordinateSearch(trimmedQuery);
      if (coordinateLocation) {
        applyUserLocation(coordinateLocation);
        return;
      }

      const params = new URLSearchParams({
        addressdetails: '1',
        bounded: '1',
        countrycodes: 'us',
        format: 'jsonv2',
        limit: '1',
        q: normalizeWyomingQuery(trimmedQuery),
        viewbox: WYOMING_VIEWBOX,
      });
      const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Geocoder unavailable');
      }

      const results = (await response.json()) as NominatimSearchResult[];
      const firstResult = results[0];
      if (!firstResult) {
        throw new Error('No Wyoming match found');
      }

      const lat = Number(firstResult.lat);
      const lng = Number(firstResult.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInsideWyoming(lat, lng)) {
        throw new Error('No Wyoming match found');
      }

      applyUserLocation({
        label: shortenLocationLabel(firstResult.display_name ?? trimmedQuery),
        lat,
        lng,
        source: 'address',
      });
    } catch (error) {
      setUserLocation(null);
      setLocationError(error instanceof Error ? error.message : 'Location lookup failed');
    } finally {
      setIsGeocoding(false);
    }
  }

  function clearUserLocation() {
    setAddressQuery('');
    setLocationError('');
    setUserLocation(null);
  }

  function addCustomDataSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = dataSourceDraft.name.trim();
    const url = dataSourceDraft.url.trim();
    const notes = dataSourceDraft.notes.trim();

    if (!name || !url) return;

    const newSource: CustomDataSource = {
      id: crypto.randomUUID(),
      name,
      type: dataSourceDraft.type,
      url,
      notes,
      addedAt: new Date().toISOString(),
    };

    setCustomDataSources((current) => [newSource, ...current]);
    setDataSourceDraft({
      name: '',
      type: 'Reference',
      url: '',
      notes: '',
    });
  }

  function removeCustomDataSource(id: string) {
    setCustomDataSources((current) => current.filter((source) => source.id !== id));
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

        <section className="filter-block location-block" aria-labelledby="start-address">
          <div className="section-title">
            <MapPinned size={15} />
            <h2 id="start-address">Start Address</h2>
          </div>
          <form className="address-form" onSubmit={locateAddress}>
            <label className="address-field">
              <span className="sr-only">Wyoming address, town, or coordinates</span>
              <input
                value={addressQuery}
                onChange={(event) => setAddressQuery(event.target.value)}
                placeholder="Casper, WY or 42.86, -106.31"
                aria-label="Wyoming address, town, or coordinates"
              />
            </label>
            <label className="radius-field">
              <span>Radius</span>
              <select
                value={searchRadiusMiles}
                onChange={(event) => setSearchRadiusMiles(Number(event.target.value))}
                aria-label="Dig search radius"
              >
                <option value={10}>10 mi</option>
                <option value={25}>25 mi</option>
                <option value={50}>50 mi</option>
                <option value={75}>75 mi</option>
                <option value={100}>100 mi</option>
              </select>
            </label>
            <div className="address-actions">
              <button className="sidebar-button sidebar-button-primary" type="submit" disabled={isGeocoding}>
                {isGeocoding ? <LoaderCircle className="spin" size={15} /> : <Navigation size={15} />}
                Center map
              </button>
              {userLocation && (
                <button className="sidebar-button sidebar-button-ghost" type="button" onClick={clearUserLocation}>
                  Clear
                </button>
              )}
            </div>
          </form>
          {locationError && <p className="location-message is-error">{locationError}</p>}
          {userLocation && nearestHotspot && (
            <div className="location-result" aria-live="polite">
              <div className="location-result-header">
                <strong>{userLocation.label}</strong>
                <span>{hotspotsInsideRadius.length} in radius</span>
              </div>
              <button
                className="nearest-link"
                type="button"
                onClick={() => setSelectedId(nearestHotspot.hotspot.id)}
              >
                <span>Nearest candidate</span>
                <strong>
                  {nearestHotspot.hotspot.name} · {formatMiles(nearestHotspot.distanceMiles)}
                </strong>
              </button>
            </div>
          )}
        </section>

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
          <label className="select-field basemap-field">
            <span>Basemap</span>
            <select value={activeBasemap} onChange={(event) => setActiveBasemap(event.target.value as BasemapId)}>
              {BASEMAP_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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

        <DataStatusPanel customSources={customDataSources} logs={logs} />

        <DataSettingsPanel
          draft={dataSourceDraft}
          sources={customDataSources}
          onAdd={addCustomDataSource}
          onChange={setDataSourceDraft}
          onRemove={removeCustomDataSource}
        />

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
              activeBasemap={activeBasemap}
              filteredHotspots={filteredHotspots.map((item) => item.hotspot)}
              layers={layers}
              selectedId={selected.hotspot.id}
              userLocation={userLocation}
              searchRadiusMiles={searchRadiusMiles}
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
                <i className="legend-ring access" /> Public access
              </span>
              <span>
                <i className="legend-ring claim" /> Claim risk
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

function DataStatusPanel({
  customSources,
  logs,
}: {
  customSources: CustomDataSource[];
  logs: FieldLog[];
}) {
  const latestLog = logs
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  const fieldLogDetail = latestLog
    ? `${logs.length} saved · last log ${formatDate(latestLog.date)}`
    : 'No browser field logs yet';
  const sourceRows = [
    ...DATA_SOURCE_STATUS,
    ...customSources.slice(0, 3).map<DataSourceStatus>((source) => ({
      name: source.name,
      status: source.type,
      detail: source.notes || 'User-added source for trip research.',
      tone: 'custom',
    })),
  ];

  return (
    <section className="filter-block data-status-block" aria-labelledby="data-status">
      <div className="section-title">
        <Database size={15} />
        <h2 id="data-status">Data Status</h2>
      </div>

      <div className="freshness-card">
        <span>Last model update</span>
        <strong>{MODEL_LAST_UPDATED}</strong>
        <em>{HOTSPOTS.length} candidate zones · seed model v0.1</em>
      </div>

      <div className="status-list">
        {sourceRows.map((source) => {
          const detail = source.name === 'Field logs' ? fieldLogDetail : source.detail;

          return (
            <div key={`${source.name}-${source.status}`} className="status-row">
              <i className={`status-indicator ${source.tone}`} aria-hidden="true" />
              <div>
                <strong>{source.name}</strong>
                <span>{detail}</span>
              </div>
              <em className={`status-pill ${source.tone}`}>{source.status}</em>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DataSettingsPanel({
  draft,
  sources,
  onAdd,
  onChange,
  onRemove,
}: {
  draft: {
    name: string;
    type: CustomDataSource['type'];
    url: string;
    notes: string;
  };
  sources: CustomDataSource[];
  onAdd: (event: FormEvent<HTMLFormElement>) => void;
  onChange: React.Dispatch<
    React.SetStateAction<{
      name: string;
      type: CustomDataSource['type'];
      url: string;
      notes: string;
    }>
  >;
  onRemove: (id: string) => void;
}) {
  return (
    <details className="filter-block data-settings-block">
      <summary>
        <span className="section-title">
          <SlidersHorizontal size={15} />
          <span>Data Settings</span>
        </span>
        <span>{sources.length} saved</span>
      </summary>

      <form className="source-form" onSubmit={onAdd}>
        <label>
          Source name
          <input
            value={draft.name}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
            placeholder="County GIS, rock guide, claim map"
          />
        </label>
        <label>
          Source type
          <select
            value={draft.type}
            onChange={(event) => onChange((current) => ({ ...current, type: event.target.value as CustomDataSource['type'] }))}
          >
            <option>Reference</option>
            <option>Service/API</option>
            <option>Dataset</option>
            <option>Claim/access</option>
          </select>
        </label>
        <label>
          URL or path
          <input
            value={draft.url}
            onChange={(event) => onChange((current) => ({ ...current, url: event.target.value }))}
            placeholder="https://... or internal notes path"
            type="text"
          />
        </label>
        <label>
          Notes
          <textarea
            value={draft.notes}
            onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))}
            placeholder="What this source verifies, coverage area, or refresh caveat."
          />
        </label>
        <button className="sidebar-button sidebar-button-primary" type="submit" disabled={!draft.name.trim() || !draft.url.trim()}>
          <Plus size={15} />
          Add source
        </button>
      </form>

      {sources.length > 0 && (
        <div className="custom-source-list">
          {sources.map((source) => {
            const canOpenSource = /^https?:\/\//i.test(source.url);

            return (
              <div className="custom-source-row" key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  <span>{source.type} · added {formatDate(source.addedAt)}</span>
                </div>
                {canOpenSource ? (
                  <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.name}`}>
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <button type="button" disabled title={source.url} aria-label={`${source.name} saved as a path`}>
                    <BookOpen size={14} />
                  </button>
                )}
                <button type="button" onClick={() => onRemove(source.id)} aria-label={`Remove ${source.name}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </details>
  );
}

type MapFeatureProperties = Record<string, string | number | boolean | null>;
type MapFeature =
  | {
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: MapFeatureProperties;
    }
  | {
      type: 'Feature';
      geometry: { type: 'LineString'; coordinates: number[][] };
      properties: MapFeatureProperties;
    }
  | {
      type: 'Feature';
      geometry: { type: 'Polygon'; coordinates: number[][][] };
      properties: MapFeatureProperties;
    };
type MapFeatureCollection = { type: 'FeatureCollection'; features: MapFeature[] };

function featureCollection(features: MapFeature[] = []): MapFeatureCollection {
  return { type: 'FeatureCollection', features };
}

function getMarkerTone(hotspot: Hotspot, score: number) {
  return hotspot.accessStatus === 'Restricted / no-go' ? 'blocked' : getScoreTone(score);
}

function buildHotspotFeature(hotspot: Hotspot, extra: MapFeatureProperties = {}): MapFeature {
  const score = calculateRockScore(hotspot.scoreFactors);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [hotspot.lng, hotspot.lat] },
    properties: {
      id: hotspot.id,
      name: hotspot.name,
      score,
      tone: getMarkerTone(hotspot, score),
      ...extra,
    },
  };
}

function setSourceData(map: MapLibreMap, sourceId: string, data: MapFeatureCollection) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data as Parameters<GeoJSONSource['setData']>[0]);
}

function setLayerVisibility(map: MapLibreMap, layerIds: string[], visible: boolean) {
  layerIds.forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  });
}

function wyomingFrameData(): MapFeatureCollection {
  return featureCollection([
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [WY_BOUNDS.minLng, WY_BOUNDS.minLat],
            [WY_BOUNDS.maxLng, WY_BOUNDS.minLat],
            [WY_BOUNDS.maxLng, WY_BOUNDS.maxLat],
            [WY_BOUNDS.minLng, WY_BOUNDS.maxLat],
            [WY_BOUNDS.minLng, WY_BOUNDS.minLat],
          ],
        ],
      },
      properties: {},
    },
  ]);
}

function routeLineData(): MapFeatureCollection {
  return featureCollection(
    ROAD_LINES.map((line, index) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line },
      properties: { id: `research-route-${index + 1}` },
    })),
  );
}

function radiusAreaData(location: UserLocation | null, radiusMiles: number): MapFeatureCollection {
  if (!location) return featureCollection();

  const earthRadiusMiles = 3958.8;
  const angularDistance = radiusMiles / earthRadiusMiles;
  const lat = (location.lat * Math.PI) / 180;
  const lng = (location.lng * Math.PI) / 180;
  const points: [number, number][] = [];

  for (let bearingDegrees = 0; bearingDegrees <= 360; bearingDegrees += 4) {
    const bearing = (bearingDegrees * Math.PI) / 180;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angularDistance) +
        Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLng =
      lng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
        Math.cos(angularDistance) - Math.sin(lat) * Math.sin(pointLat),
      );

    points.push([(pointLng * 180) / Math.PI, (pointLat * 180) / Math.PI]);
  }

  return featureCollection([
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [points] },
      properties: { radiusMiles },
    },
  ]);
}

function radiusBounds(location: UserLocation, radiusMiles: number): [[number, number], [number, number]] {
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.max(Math.cos((location.lat * Math.PI) / 180), 0.2));

  return [
    [location.lng - lngDelta, location.lat - latDelta],
    [location.lng + lngDelta, location.lat + latDelta],
  ];
}

function radiusFitMaxZoom(radiusMiles: number) {
  if (radiusMiles <= 10) return 10.8;
  if (radiusMiles <= 25) return 9.7;
  if (radiusMiles <= 50) return 8.8;
  if (radiusMiles <= 75) return 8.3;
  return 7.9;
}

function WyomingMap({
  activeBasemap,
  filteredHotspots,
  layers,
  selectedId,
  userLocation,
  searchRadiusMiles,
  onSelect,
}: {
  activeBasemap: BasemapId;
  filteredHotspots: Hotspot[];
  layers: LayerToggleState;
  selectedId: string;
  userLocation: UserLocation | null;
  searchRadiusMiles: number;
  onSelect: (id: string) => void;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const userMarkerRef = useRef<Marker | null>(null);
  const mapReadyRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const visibleIds = useMemo(() => new Set(filteredHotspots.map((hotspot) => hotspot.id)), [filteredHotspots]);
  const selectedHotspot = useMemo(
    () => HOTSPOTS.find((hotspot) => hotspot.id === selectedId) ?? HOTSPOTS[0],
    [selectedId],
  );
  const activeBasemapOption =
    BASEMAP_OPTIONS.find((option) => option.id === activeBasemap) ?? BASEMAP_OPTIONS[0];

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      attributionControl: false,
      center: WYOMING_CENTER,
      container: mapNodeRef.current,
      dragRotate: false,
      maxBounds: WYOMING_MAX_BOUNDS,
      maxZoom: 18.5,
      minZoom: 5,
      pitchWithRotate: false,
      style: MAP_STYLE,
      zoom: 6,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      map.addSource('wyoming-frame', { type: 'geojson', data: wyomingFrameData() });
      map.addLayer({
        id: 'wyoming-frame-fill',
        type: 'fill',
        source: 'wyoming-frame',
        paint: {
          'fill-color': '#fff8ea',
          'fill-opacity': 0.07,
        },
      });
      map.addLayer({
        id: 'wyoming-frame-line',
        type: 'line',
        source: 'wyoming-frame',
        paint: {
          'line-color': '#223328',
          'line-opacity': 0.52,
          'line-width': 2,
        },
      });

      map.addSource('user-radius', { type: 'geojson', data: featureCollection() });
      map.addLayer({
        id: 'user-radius-fill',
        type: 'fill',
        source: 'user-radius',
        paint: {
          'fill-color': '#cf7b48',
          'fill-opacity': 0.1,
        },
      });
      map.addLayer({
        id: 'user-radius-line',
        type: 'line',
        source: 'user-radius',
        paint: {
          'line-color': '#a65231',
          'line-dasharray': [2, 1.6],
          'line-opacity': 0.78,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 8, 2.4],
        },
      });

      map.addSource('geology-signal', { type: 'geojson', data: featureCollection() });
      map.addLayer({
        id: 'geology-signal',
        type: 'circle',
        source: 'geology-signal',
        paint: {
          'circle-blur': 0.35,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.18,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 18, 8, 56],
          'circle-stroke-color': ['get', 'stroke'],
          'circle-stroke-opacity': 0.42,
          'circle-stroke-width': 1.5,
        },
      });

      map.addSource('access-signal', { type: 'geojson', data: featureCollection() });
      map.addLayer({
        id: 'access-signal',
        type: 'circle',
        source: 'access-signal',
        paint: {
          'circle-color': '#5f8165',
          'circle-opacity': 0.1,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 14, 8, 42],
          'circle-stroke-color': '#5f8165',
          'circle-stroke-opacity': 0.42,
          'circle-stroke-width': 1.2,
        },
      });

      map.addSource('claim-signal', { type: 'geojson', data: featureCollection() });
      map.addLayer({
        id: 'claim-signal',
        type: 'circle',
        source: 'claim-signal',
        paint: {
          'circle-color': '#8b3030',
          'circle-opacity': 0.08,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 16, 8, 46],
          'circle-stroke-color': '#8b3030',
          'circle-stroke-opacity': 0.52,
          'circle-stroke-width': 1.4,
        },
      });

      map.addSource('research-routes', { type: 'geojson', data: routeLineData() });
      map.addLayer({
        id: 'research-routes',
        type: 'line',
        source: 'research-routes',
        paint: {
          'line-color': '#6c756b',
          'line-dasharray': [2, 2],
          'line-opacity': 0.6,
          'line-width': 2.2,
        },
      });

      mapReadyRef.current = true;
      setMapReady(true);
      map.resize();
    });

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      userMarkerRef.current?.remove();
      map.remove();
      mapReadyRef.current = false;
      setMapReady(false);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    BASEMAP_LAYER_IDS.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(layerId, 'visibility', layerId === activeBasemapOption.layerId ? 'visible' : 'none');
    });
  }, [activeBasemapOption.layerId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    setSourceData(
      map,
      'geology-signal',
      featureCollection(
        filteredHotspots.map((hotspot) =>
          buildHotspotFeature(hotspot, {
            color: hotspot.targetMaterials.includes('Jade')
              ? '#5f8165'
              : hotspot.targetMaterials.includes('Petrified wood')
                ? '#b45f35'
                : '#45738f',
            stroke: hotspot.targetMaterials.includes('Jade') ? '#3c6145' : '#4f6e80',
          }),
        ),
      ),
    );
    setSourceData(
      map,
      'access-signal',
      featureCollection(
        filteredHotspots
          .filter((hotspot) => hotspot.accessStatus === 'Likely public')
          .map((hotspot) => buildHotspotFeature(hotspot)),
      ),
    );
    setSourceData(
      map,
      'claim-signal',
      featureCollection(
        filteredHotspots
          .filter((hotspot) => hotspot.claimRisk === 'High' || hotspot.claimRisk === 'Medium')
          .map((hotspot) => buildHotspotFeature(hotspot)),
      ),
    );

    setLayerVisibility(map, ['geology-signal'], layers.geology);
    setLayerVisibility(map, ['access-signal'], layers.publicLand);
    setLayerVisibility(map, ['claim-signal'], layers.claims);
    setLayerVisibility(map, ['research-routes'], layers.roads);
  }, [filteredHotspots, layers, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = filteredHotspots.map((hotspot) => {
      const score = calculateRockScore(hotspot.scoreFactors);
      const tone = getMarkerTone(hotspot, score);
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `map-score-marker ${tone} ${hotspot.id === selectedId ? 'is-selected' : ''}`;
      element.setAttribute('aria-label', `Select ${hotspot.name}, rock score ${score}`);
      element.title = `${hotspot.name} · ${score}`;
      element.innerHTML = `<span>${score}</span>`;
      element.addEventListener('click', () => onSelect(hotspot.id));

      return new maplibregl.Marker({ anchor: 'bottom', element, offset: [0, -4] })
        .setLngLat([hotspot.lng, hotspot.lat])
        .addTo(map);
    });
  }, [filteredHotspots, mapReady, onSelect, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    map.easeTo({
      center: [selectedHotspot.lng, selectedHotspot.lat],
      duration: 650,
      essential: true,
      zoom: Math.max(map.getZoom(), 6.45),
    });
  }, [mapReady, selectedHotspot]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    setSourceData(map, 'user-radius', radiusAreaData(userLocation, searchRadiusMiles));
  }, [mapReady, searchRadiusMiles, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    userMarkerRef.current?.remove();
    userMarkerRef.current = null;

    if (!userLocation) return;

    const element = document.createElement('div');
    element.className = 'map-origin-marker';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', `Start address: ${userLocation.label}`);
    element.title = userLocation.label;
    element.innerHTML = '<span></span>';

    userMarkerRef.current = new maplibregl.Marker({ anchor: 'bottom', element, offset: [0, -6] })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(map);

    map.fitBounds(radiusBounds(userLocation, searchRadiusMiles), {
      duration: 700,
      essential: true,
      maxZoom: radiusFitMaxZoom(searchRadiusMiles),
      padding: { bottom: 86, left: 72, right: 72, top: 72 },
    });
  }, [mapReady, searchRadiusMiles, userLocation]);

  return (
    <div className="map-canvas">
      <div ref={mapNodeRef} className="maplibre-host" aria-label="Interactive Wyoming candidate hotspot map" />
      <div className="map-status-strip" aria-hidden="true">
        <span>
          {activeBasemapOption.label} · native z{activeBasemapOption.nativeZoom}
        </span>
        <span>{visibleIds.size} filtered targets</span>
      </div>
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
