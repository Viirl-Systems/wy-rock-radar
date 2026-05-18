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
  LocateFixed,
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
import { DATA_SOURCES, HOTSPOTS, MATERIALS, ROCKHOUNDING_ORG_LOCATIONS } from './data';
import { calculateRockScore, explainScore, getScoreBand, getScoreTone } from './scoring';
import type {
  CommunityReferenceLocation,
  FieldLog,
  FieldPin,
  Hotspot,
  LayerToggleState,
  MapProviderSettings,
  Material,
  TrackPoint,
  WalkTrack,
} from './types';

const STORAGE_KEY = 'wy-rock-radar-field-logs';
const CUSTOM_DATA_SOURCES_STORAGE_KEY = 'wy-rock-radar-custom-data-sources';
const FIELD_PINS_STORAGE_KEY = 'wy-rock-radar-field-pins';
const WALK_TRACKS_STORAGE_KEY = 'wy-rock-radar-walk-tracks';
const MAP_PROVIDER_SETTINGS_STORAGE_KEY = 'wy-rock-radar-map-provider-settings';
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

type BasemapId = 'street' | 'topo' | 'imagery' | 'hybrid' | 'arcgis' | 'mapbox' | 'maptiler' | 'custom';

const DEFAULT_BASEMAP_ID: BasemapId = 'hybrid';
type BasemapOption = {
  id: BasemapId;
  label: string;
  layerId: string;
  nativeZoom: number;
  configured?: boolean;
};

const BUILT_IN_BASEMAP_OPTIONS: BasemapOption[] = [
  { id: 'hybrid', label: 'USGS aerial + topo', layerId: 'basemap-usgs-hybrid', nativeZoom: 16 },
  { id: 'imagery', label: 'USGS aerial', layerId: 'basemap-usgs-imagery', nativeZoom: 16 },
  { id: 'topo', label: 'USGS topo', layerId: 'basemap-usgs-topo', nativeZoom: 16 },
  { id: 'street', label: 'Street', layerId: 'basemap-street', nativeZoom: 19 },
];
const OPTIONAL_BASEMAP_OPTIONS: BasemapOption[] = [
  { id: 'arcgis', label: 'ArcGIS World Imagery', layerId: 'basemap-arcgis', nativeZoom: 19 },
  { id: 'mapbox', label: 'Mapbox satellite', layerId: 'basemap-mapbox', nativeZoom: 18 },
  { id: 'maptiler', label: 'MapTiler satellite', layerId: 'basemap-maptiler', nativeZoom: 18 },
  { id: 'custom', label: 'Custom imagery URL', layerId: 'basemap-custom', nativeZoom: 19 },
];
const BASEMAP_OPTIONS = [...BUILT_IN_BASEMAP_OPTIONS, ...OPTIONAL_BASEMAP_OPTIONS];
const BASEMAP_LAYER_IDS = BASEMAP_OPTIONS.map((option) => option.layerId);

const DEFAULT_MAP_PROVIDER_SETTINGS: MapProviderSettings = {
  arcgisKey: '',
  mapboxToken: '',
  maptilerKey: '',
  customTileUrl: '',
  customAttribution: '',
};

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
  communitySites: true,
  notes: true,
};

type UserLocation = {
  label: string;
  lat: number;
  lng: number;
  source: 'address' | 'coordinates' | 'gps' | 'pin';
  accuracyMeters?: number;
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

function formatAccuracy(value?: number) {
  if (!value || !Number.isFinite(value)) return 'accuracy unknown';
  if (value < 100) return `±${Math.round(value)} m GPS`;
  return `±${(value / 1609.34).toFixed(1)} mi GPS`;
}

const COMMUNITY_MATERIAL_TERMS: Record<Material, string[]> = {
  Agate: ['agate', 'dry head agate', 'moss agate', 'turritella agate', 'sweetwater agate', 'goniobasis agate'],
  Jasper: ['jasper', 'red jasper', 'yellow jasper'],
  Jade: ['jade', 'nephrite'],
  'Petrified wood': ['petrified wood', 'agatized wood', 'opalized wood', 'silicified wood'],
  Quartz: ['quartz', 'quartzite'],
  'Quartz crystals': ['quartz crystal', 'quartz crystals'],
  Chalcedony: ['chalcedony', 'silicified algae'],
  'Common opal': ['opal', 'opalized'],
  'Chert / flint': ['chert', 'flint'],
  'Geodes / nodules': ['geode', 'geodes', 'concretion', 'concretions', 'nodule', 'nodules'],
  'Gold indicators': ['gold'],
  'Diamond indicators': ['diamond', 'garnet', 'diopside', 'ilmenite', 'chromite'],
  'Kimberlite / lamproite': ['kimberlite', 'lamproite'],
  Garnet: ['garnet'],
  'Chromian diopside': ['diopside', 'chromian diopside', 'chrome diopside'],
  'Picroilmenite / ilmenite': ['ilmenite', 'picroilmenite'],
  'Magnetite / hematite': ['magnetite', 'hematite', 'iron'],
  'Copper minerals': ['copper', 'chrysocolla', 'bornite', 'chalcocite'],
  'Malachite / azurite': ['malachite', 'azurite'],
  'Pyrite / chalcopyrite': ['pyrite', 'chalcopyrite'],
  'Feldspar / pegmatite': ['feldspar', 'pegmatite'],
  'Beryl / mica': ['beryl', 'mica', 'muscovite'],
  Amazonite: ['amazonite'],
  Tourmaline: ['tourmaline'],
  'Moonstone / labradorite': ['moonstone', 'labradorite'],
  Calcite: ['calcite'],
  Aragonite: ['aragonite'],
  Barite: ['barite'],
  Fluorite: ['fluorite'],
  Kyanite: ['kyanite'],
  'Corundum / sapphire': ['corundum', 'sapphire'],
  'Gypsum / selenite': ['gypsum', 'selenite'],
  'Travertine / onyx marble': ['travertine', 'onyx marble'],
  Alabaster: ['alabaster'],
  Bloodstone: ['bloodstone'],
  Obsidian: ['obsidian'],
  'Fossil caution': ['fossil', 'dinosaur', 'gastrolith', 'turritella', 'silicified algae'],
  'Uranium caution': ['uranium', 'uraninite', 'uranophane', 'autunite', 'coffinite'],
  'Unusual minerals': ['mineral', 'crystal', 'stechemigite', 'ilsemannite', 'anhydrite'],
};

function communityLocationMatchesMaterials(location: CommunityReferenceLocation, selectedMaterials: Material[]) {
  if (selectedMaterials.length === 0) return true;
  const foundText = location.foundHere.join(' ').toLowerCase();

  return selectedMaterials.some((material) =>
    (COMMUNITY_MATERIAL_TERMS[material] ?? [material]).some((term) => foundText.includes(term.toLowerCase())),
  );
}

function communityLocationMatchesQuery(location: CommunityReferenceLocation, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [location.name, location.locationType, ...location.foundHere].join(' ').toLowerCase().includes(normalizedQuery);
}

function getTrackDistanceMiles(points: TrackPoint[]) {
  return points.reduce((total, point, index) => {
    if (index === 0) return total;
    return total + getDistanceMiles(points[index - 1], point);
  }, 0);
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

function readStoredFieldPins(): FieldPin[] {
  try {
    const raw = localStorage.getItem(FIELD_PINS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FieldPin[]) : [];
  } catch {
    return [];
  }
}

function readStoredWalkTracks(): WalkTrack[] {
  try {
    const raw = localStorage.getItem(WALK_TRACKS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WalkTrack[]) : [];
  } catch {
    return [];
  }
}

function readStoredMapProviderSettings(): MapProviderSettings {
  try {
    const raw = localStorage.getItem(MAP_PROVIDER_SETTINGS_STORAGE_KEY);
    return raw ? { ...DEFAULT_MAP_PROVIDER_SETTINGS, ...(JSON.parse(raw) as Partial<MapProviderSettings>) } : DEFAULT_MAP_PROVIDER_SETTINGS;
  } catch {
    return DEFAULT_MAP_PROVIDER_SETTINGS;
  }
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return 'Location permission was blocked. Enable location access for this site.';
  if (error.code === error.POSITION_UNAVAILABLE) return 'GPS position is unavailable right now. Try again outside or with better signal.';
  if (error.code === error.TIMEOUT) return 'GPS lookup timed out. Try again with a clearer sky view.';
  return error.message || 'GPS lookup failed.';
}

function positionToUserLocation(position: GeolocationPosition, label = 'Current GPS location'): UserLocation {
  return {
    label,
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    source: 'gps',
    accuracyMeters: position.coords.accuracy,
  };
}

function positionToTrackPoint(position: GeolocationPosition): TrackPoint {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
    timestamp: new Date(position.timestamp || Date.now()).toISOString(),
  };
}

function requestCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not support GPS location.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 14000,
    });
  });
}

function getAvailableBasemaps(settings: MapProviderSettings): BasemapOption[] {
  return [
    ...BUILT_IN_BASEMAP_OPTIONS,
    { ...OPTIONAL_BASEMAP_OPTIONS[0], configured: true },
    { ...OPTIONAL_BASEMAP_OPTIONS[1], configured: Boolean(settings.mapboxToken.trim()) },
    { ...OPTIONAL_BASEMAP_OPTIONS[2], configured: Boolean(settings.maptilerKey.trim()) },
    { ...OPTIONAL_BASEMAP_OPTIONS[3], configured: Boolean(settings.customTileUrl.trim()) },
  ];
}

function isBasemapConfigured(option: BasemapOption) {
  return option.configured ?? true;
}

export default function App() {
  const [selectedId, setSelectedId] = useState(HOTSPOTS[0].id);
  const [selectedMaterials, setSelectedMaterials] = useState<Material[]>([]);
  const [accessFilter, setAccessFilter] = useState('All');
  const [minimumScore, setMinimumScore] = useState(45);
  const [query, setQuery] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [searchRadiusMiles, setSearchRadiusMiles] = useState(50);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [activeBasemap, setActiveBasemap] = useState<BasemapId>(DEFAULT_BASEMAP_ID);
  const [layers, setLayers] = useState<LayerToggleState>(initialLayerState);
  const [logs, setLogs] = useState<FieldLog[]>(() => readStoredLogs());
  const [fieldPins, setFieldPins] = useState<FieldPin[]>(() => readStoredFieldPins());
  const [walkTracks, setWalkTracks] = useState<WalkTrack[]>(() => readStoredWalkTracks());
  const [activeTrack, setActiveTrack] = useState<WalkTrack | null>(null);
  const [customDataSources, setCustomDataSources] = useState<CustomDataSource[]>(() => readStoredCustomDataSources());
  const [mapProviderSettings, setMapProviderSettings] = useState<MapProviderSettings>(() => readStoredMapProviderSettings());
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const [fieldDraft, setFieldDraft] = useState({
    materialGuess: 'Unknown' as FieldLog['materialGuess'],
    quality: 3,
    quantity: 'Unknown' as FieldLog['quantity'],
    returnWorthy: true,
    notes: '',
  });
  const [quickLogDraft, setQuickLogDraft] = useState({
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem(FIELD_PINS_STORAGE_KEY, JSON.stringify(fieldPins));
  }, [fieldPins]);

  useEffect(() => {
    localStorage.setItem(WALK_TRACKS_STORAGE_KEY, JSON.stringify(walkTracks));
  }, [walkTracks]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_DATA_SOURCES_STORAGE_KEY, JSON.stringify(customDataSources));
  }, [customDataSources]);

  useEffect(() => {
    localStorage.setItem(MAP_PROVIDER_SETTINGS_STORAGE_KEY, JSON.stringify(mapProviderSettings));
  }, [mapProviderSettings]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
      }
    };
  }, []);

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

  const visibleCommunityLocations = useMemo(
    () =>
      ROCKHOUNDING_ORG_LOCATIONS.filter(
        (location) =>
          communityLocationMatchesMaterials(location, selectedMaterials) && communityLocationMatchesQuery(location, query),
      ),
    [query, selectedMaterials],
  );

  useEffect(() => {
    if (!filteredHotspots.length) return;
    if (filteredHotspots.some(({ hotspot }) => hotspot.id === selectedId)) return;
    setSelectedId(filteredHotspots[0].hotspot.id);
  }, [filteredHotspots, selectedId]);

  const selected = useMemo(() => {
    return scoredHotspots.find(({ hotspot }) => hotspot.id === selectedId) ?? scoredHotspots[0];
  }, [scoredHotspots, selectedId]);

  const selectedLogs = logs.filter((log) => log.hotspotId === selected.hotspot.id);
  const availableBasemaps = useMemo(() => getAvailableBasemaps(mapProviderSettings), [mapProviderSettings]);
  const selectedDistanceMiles = userLocation ? getDistanceMiles(userLocation, selected.hotspot) : null;

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

  const nearestPin = useMemo(() => {
    if (!userLocation || !fieldPins.length) return null;

    return fieldPins
      .map((pin) => ({
        pin,
        distanceMiles: getDistanceMiles(userLocation, pin),
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)[0];
  }, [fieldPins, userLocation]);

  const activeTrackDistance = activeTrack ? getTrackDistanceMiles(activeTrack.points) : 0;

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
    setAddressQuery(location.source === 'gps' ? '' : addressQuery);
    if (nearest) {
      setSelectedId(nearest.hotspot.id);
    }
  }

  async function useCurrentLocation() {
    setIsLocating(true);
    setLocationError('');

    try {
      const position = await requestCurrentPosition();
      const location = positionToUserLocation(position);
      if (!isInsideWyoming(location.lat, location.lng)) {
        throw new Error('GPS location is outside the Wyoming field map.');
      }
      applyUserLocation(location);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : geolocationErrorMessage(error as GeolocationPositionError));
    } finally {
      setIsLocating(false);
    }
  }

  async function getFieldLocationForAction() {
    if (userLocation) return userLocation;

    const position = await requestCurrentPosition();
    const location = positionToUserLocation(position);
    if (!isInsideWyoming(location.lat, location.lng)) {
      throw new Error('GPS location is outside the Wyoming field map.');
    }
    applyUserLocation(location);
    return location;
  }

  async function dropFieldPin() {
    setIsLocating(true);
    setLocationError('');

    try {
      const location = await getFieldLocationForAction();
      const pin: FieldPin = {
        id: crypto.randomUUID(),
        label: `Field pin ${fieldPins.length + 1}`,
        lat: location.lat,
        lng: location.lng,
        accuracyMeters: location.accuracyMeters,
        type: 'Current dig',
        materialGuess: 'Unknown',
        quality: 3,
        returnWorthy: true,
        notes: '',
        createdAt: new Date().toISOString(),
        source: location.source === 'gps' ? 'gps' : 'manual',
      };

      setFieldPins((current) => [pin, ...current]);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : geolocationErrorMessage(error as GeolocationPositionError));
    } finally {
      setIsLocating(false);
    }
  }

  function startWalkTrack() {
    if (!navigator.geolocation) {
      setLocationError('This browser does not support GPS walk tracking.');
      return;
    }

    setLocationError('');
    const startedAt = new Date().toISOString();
    const newTrack: WalkTrack = {
      id: crypto.randomUUID(),
      label: `Walk ${formatDate(startedAt)}`,
      startedAt,
      points: [],
      distanceMiles: 0,
    };

    setActiveTrack(newTrack);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const location = positionToUserLocation(position);
        const point = positionToTrackPoint(position);
        if (isInsideWyoming(location.lat, location.lng)) {
          setUserLocation(location);
        }
        setActiveTrack((current) => {
          if (!current) return current;
          const points = [...current.points, point];
          return { ...current, points, distanceMiles: getTrackDistanceMiles(points) };
        });
      },
      (error) => setLocationError(geolocationErrorMessage(error)),
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 16000,
      },
    );
  }

  function stopWalkTrack() {
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (activeTrack && activeTrack.points.length > 0) {
      const completedTrack: WalkTrack = {
        ...activeTrack,
        endedAt: new Date().toISOString(),
        distanceMiles: getTrackDistanceMiles(activeTrack.points),
      };
      setWalkTracks((current) => [completedTrack, ...current]);
    } else if (activeTrack) {
      setLocationError('Walk tracking stopped before a GPS point was captured.');
    }

    setActiveTrack(null);
  }

  function toggleWalkTrack() {
    if (activeTrack) {
      stopWalkTrack();
      return;
    }

    startWalkTrack();
  }

  function selectFieldPin(pin: FieldPin) {
    applyUserLocation({
      label: pin.label,
      lat: pin.lat,
      lng: pin.lng,
      source: 'pin',
      accuracyMeters: pin.accuracyMeters,
    });
  }

  function removeFieldPin(id: string) {
    setFieldPins((current) => current.filter((pin) => pin.id !== id));
  }

  function removeWalkTrack(id: string) {
    setWalkTracks((current) => current.filter((track) => track.id !== id));
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
      targetType: 'hotspot',
      targetLabel: selected.hotspot.name,
      lat: selected.hotspot.lat,
      lng: selected.hotspot.lng,
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

  function addQuickFieldLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetLocation = userLocation ?? {
      label: selected.hotspot.name,
      lat: selected.hotspot.lat,
      lng: selected.hotspot.lng,
      source: 'coordinates' as const,
    };
    const nearestDroppedPin = fieldPins.find(
      (pin) => userLocation && getDistanceMiles(userLocation, pin) < 0.03,
    );
    const newLog: FieldLog = {
      id: crypto.randomUUID(),
      hotspotId: selected.hotspot.id,
      targetType: nearestDroppedPin ? 'pin' : userLocation ? 'gps' : 'hotspot',
      targetLabel: nearestDroppedPin?.label ?? targetLocation.label,
      pinId: nearestDroppedPin?.id,
      lat: targetLocation.lat,
      lng: targetLocation.lng,
      accuracyMeters: targetLocation.accuracyMeters,
      date: new Date().toISOString(),
      materialGuess: quickLogDraft.materialGuess,
      quality: quickLogDraft.quality,
      quantity: quickLogDraft.quantity,
      returnWorthy: quickLogDraft.returnWorthy,
      notes: quickLogDraft.notes.trim(),
    };

    setLogs((current) => [newLog, ...current]);
    setQuickLogDraft({
      materialGuess: 'Unknown',
      quality: 3,
      quantity: 'Unknown',
      returnWorthy: true,
      notes: '',
    });
    setIsQuickLogOpen(false);
  }

  function exportCsv() {
    const rows = [
      [
        'Record type',
        'Name',
        'County',
        'Score',
        'Band',
        'Access',
        'Claim risk',
        'Materials',
        'Latitude',
        'Longitude',
        'Distance miles',
        'Geology',
        'Log date',
        'Material guess',
        'Quality',
        'Quantity',
        'Return worthy',
        'Notes',
      ],
      ...scoredHotspots.map(({ hotspot, score, band }) => [
        'candidate',
        hotspot.name,
        hotspot.county,
        score,
        band,
        hotspot.accessStatus,
        hotspot.claimRisk,
        hotspot.targetMaterials.join('; '),
        hotspot.lat,
        hotspot.lng,
        '',
        hotspot.geologyUnit,
        '',
        '',
        '',
        '',
        '',
        hotspot.sourceNotes.join('; '),
      ]),
      ...ROCKHOUNDING_ORG_LOCATIONS.map((location) => [
        'community reference',
        location.name,
        '',
        '',
        '',
        location.locationType,
        'Unknown',
        location.foundHere.join('; '),
        location.lat,
        location.lng,
        '',
        'Community-submitted rockhounding pin',
        '',
        '',
        '',
        '',
        '',
        location.sourceUrl,
      ]),
      ...logs.map((log) => {
        const hotspot = HOTSPOTS.find((item) => item.id === log.hotspotId);
        const score = hotspot ? calculateRockScore(hotspot.scoreFactors) : '';
        const band = hotspot ? getScoreBand(hotspot) : '';

        return [
          log.targetType ?? 'field log',
          log.targetLabel ?? hotspot?.name ?? 'Field log',
          hotspot?.county ?? '',
          score,
          band,
          hotspot?.accessStatus ?? '',
          hotspot?.claimRisk ?? '',
          hotspot?.targetMaterials.join('; ') ?? '',
          log.lat ?? hotspot?.lat ?? '',
          log.lng ?? hotspot?.lng ?? '',
          '',
          hotspot?.geologyUnit ?? '',
          formatDate(log.date),
          log.materialGuess,
          log.quality,
          log.quantity,
          log.returnWorthy ? 'yes' : 'no',
          log.notes,
        ];
      }),
      ...fieldPins.map((pin) => [
        'field pin',
        pin.label,
        '',
        '',
        '',
        '',
        '',
        pin.materialGuess,
        pin.lat,
        pin.lng,
        '',
        '',
        formatDate(pin.createdAt),
        pin.materialGuess,
        pin.quality,
        '',
        pin.returnWorthy ? 'yes' : 'no',
        pin.notes,
      ]),
      ...walkTracks.map((track) => [
        'walk track',
        track.label,
        '',
        '',
        '',
        '',
        '',
        '',
        track.points[0]?.lat ?? '',
        track.points[0]?.lng ?? '',
        track.distanceMiles.toFixed(2),
        '',
        formatDate(track.startedAt),
        '',
        '',
        '',
        '',
        `${track.points.length} GPS points${track.endedAt ? ` · ended ${formatDate(track.endedAt)}` : ''}`,
      ]),
    ];

    downloadFile('wy-rock-radar-field-log.csv', rows.map((row) => row.map(csvEscape).join(',')).join('\n'), 'text/csv');
  }

  function exportGeoJson() {
    const activeTrackFeature = activeTrack?.points.length
      ? [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: activeTrack.points.map((point) => [point.lng, point.lat]),
            },
            properties: {
              id: activeTrack.id,
              recordType: 'activeWalkTrack',
              label: activeTrack.label,
              startedAt: activeTrack.startedAt,
              distanceMiles: getTrackDistanceMiles(activeTrack.points),
              pointCount: activeTrack.points.length,
            },
          },
        ]
      : [];
    const features = [
      ...scoredHotspots.map(({ hotspot, score, band }) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [hotspot.lng, hotspot.lat],
        },
        properties: {
          id: hotspot.id,
          recordType: 'candidate',
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
      })),
      ...fieldPins.map((pin) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [pin.lng, pin.lat],
        },
        properties: {
          ...pin,
          recordType: 'fieldPin',
        },
      })),
      ...ROCKHOUNDING_ORG_LOCATIONS.map((location) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [location.lng, location.lat],
        },
        properties: {
          ...location,
          recordType: 'communityReference',
          warning: 'Community-submitted reference. Verify before field use.',
        },
      })),
      ...walkTracks.map((track) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: track.points.map((point) => [point.lng, point.lat]),
        },
        properties: {
          id: track.id,
          recordType: 'walkTrack',
          label: track.label,
          startedAt: track.startedAt,
          endedAt: track.endedAt,
          distanceMiles: track.distanceMiles,
          pointCount: track.points.length,
        },
      })),
      ...activeTrackFeature,
    ];

    downloadFile(
      'wy-rock-radar-field-data.geojson',
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

        <FieldModePanel
          activeTrack={activeTrack}
          activeTrackDistance={activeTrackDistance}
          fieldPins={fieldPins}
          isLocating={isLocating}
          nearestHotspot={nearestHotspot}
          nearestPin={nearestPin}
          onDropPin={dropFieldPin}
          onQuickLog={() => setIsQuickLogOpen(true)}
          onToggleTrack={toggleWalkTrack}
          onUseLocation={useCurrentLocation}
          selectedDistanceMiles={selectedDistanceMiles}
          walkTracks={walkTracks}
        />

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
              {availableBasemaps.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}{isBasemapConfigured(option) ? '' : ' · setup needed'}
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

        <DataStatusPanel
          customSources={customDataSources}
          fieldPins={fieldPins}
          logs={logs}
          providerSettings={mapProviderSettings}
          walkTracks={walkTracks}
        />

        <DataSettingsPanel
          draft={dataSourceDraft}
          providerSettings={mapProviderSettings}
          sources={customDataSources}
          onAdd={addCustomDataSource}
          onChange={setDataSourceDraft}
          onProviderChange={setMapProviderSettings}
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
              activeTrack={activeTrack}
              communityLocations={visibleCommunityLocations}
              fieldPins={fieldPins}
              filteredHotspots={filteredHotspots.map((item) => item.hotspot)}
              layers={layers}
              providerSettings={mapProviderSettings}
              selectedId={selected.hotspot.id}
              userLocation={userLocation}
              searchRadiusMiles={searchRadiusMiles}
              walkTracks={walkTracks}
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
              <span>
                <i className="legend-dot pin" /> Field pin
              </span>
              <span>
                <i className="legend-dot community" /> Community ref
              </span>
              <span>
                <i className="legend-line walk" /> Walk path
              </span>
            </div>
          </section>

          <aside className="inspector" aria-label="Selected hotspot details">
            <Inspector
              hotspot={selected.hotspot}
              score={selected.score}
              selectedDistanceMiles={selectedDistanceMiles}
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
          <FieldNotebookPanel
            activeTrack={activeTrack}
            fieldPins={fieldPins}
            walkTracks={walkTracks}
            onRemovePin={removeFieldPin}
            onRemoveTrack={removeWalkTrack}
            onSelectPin={selectFieldPin}
          />
          <SourcePanel />
        </section>
      </section>

      <MobileFieldBar
        activeTrack={activeTrack}
        isLocating={isLocating}
        onDropPin={dropFieldPin}
        onQuickLog={() => setIsQuickLogOpen(true)}
        onToggleTrack={toggleWalkTrack}
        onUseLocation={useCurrentLocation}
      />

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

      {isQuickLogOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="log-modal quick-log-modal" onSubmit={addQuickFieldLog}>
            <div className="modal-heading">
              <div>
                <p className="eyeline">Quick field log</p>
                <h2>{userLocation?.label ?? selected.hotspot.name}</h2>
              </div>
              <button aria-label="Close quick log" className="icon-button" type="button" onClick={() => setIsQuickLogOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="field-log-context">
              <MapPinned size={16} />
              <span>
                {userLocation
                  ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)} · ${formatAccuracy(userLocation.accuracyMeters)}`
                  : 'No GPS yet. Log will attach to the selected candidate.'}
              </span>
            </div>

            <div className="form-grid">
              <label>
                Material guess
                <select
                  value={quickLogDraft.materialGuess}
                  onChange={(event) =>
                    setQuickLogDraft((current) => ({
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
                  value={quickLogDraft.quality}
                  onChange={(event) =>
                    setQuickLogDraft((current) => ({ ...current, quality: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                Quantity
                <select
                  value={quickLogDraft.quantity}
                  onChange={(event) =>
                    setQuickLogDraft((current) => ({ ...current, quantity: event.target.value as FieldLog['quantity'] }))
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
                  checked={quickLogDraft.returnWorthy}
                  type="checkbox"
                  onChange={(event) =>
                    setQuickLogDraft((current) => ({ ...current, returnWorthy: event.target.checked }))
                  }
                />
                Worth returning
              </label>
            </div>

            <label className="notes-field">
              Notes
              <textarea
                value={quickLogDraft.notes}
                onChange={(event) => setQuickLogDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="What did you find, where was it sitting, and should you come back?"
              />
            </label>

            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setIsQuickLogOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                <NotebookPen size={16} />
                Save quick log
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

function FieldModePanel({
  activeTrack,
  activeTrackDistance,
  fieldPins,
  isLocating,
  nearestHotspot,
  nearestPin,
  selectedDistanceMiles,
  walkTracks,
  onDropPin,
  onQuickLog,
  onToggleTrack,
  onUseLocation,
}: {
  activeTrack: WalkTrack | null;
  activeTrackDistance: number;
  fieldPins: FieldPin[];
  isLocating: boolean;
  nearestHotspot: ({ hotspot: Hotspot; distanceMiles: number } & { score: number; band: string }) | null;
  nearestPin: { pin: FieldPin; distanceMiles: number } | null;
  selectedDistanceMiles: number | null;
  walkTracks: WalkTrack[];
  onDropPin: () => void;
  onQuickLog: () => void;
  onToggleTrack: () => void;
  onUseLocation: () => void;
}) {
  return (
    <section className="filter-block field-mode-block" aria-labelledby="field-mode">
      <div className="section-title">
        <LocateFixed size={15} />
        <h2 id="field-mode">Field Mode</h2>
      </div>

      <div className="field-mode-grid">
        <button className="sidebar-button sidebar-button-primary" type="button" onClick={onUseLocation} disabled={isLocating}>
          {isLocating ? <LoaderCircle className="spin" size={15} /> : <LocateFixed size={15} />}
          Use GPS
        </button>
        <button className="sidebar-button sidebar-button-ghost" type="button" onClick={onDropPin} disabled={isLocating}>
          <MapPinned size={15} />
          Drop pin
        </button>
        <button className={`sidebar-button ${activeTrack ? 'sidebar-button-danger' : 'sidebar-button-ghost'}`} type="button" onClick={onToggleTrack}>
          <Route size={15} />
          {activeTrack ? 'Stop walk' : 'Start walk'}
        </button>
        <button className="sidebar-button sidebar-button-ghost" type="button" onClick={onQuickLog}>
          <NotebookPen size={15} />
          Quick log
        </button>
      </div>

      <div className="field-stats" aria-live="polite">
        <span>
          <strong>{selectedDistanceMiles === null ? 'GPS needed' : formatMiles(selectedDistanceMiles)}</strong>
          to selected site
        </span>
        <span>
          <strong>{nearestHotspot ? formatMiles(nearestHotspot.distanceMiles) : 'GPS needed'}</strong>
          nearest candidate
        </span>
        <span>
          <strong>{nearestPin ? formatMiles(nearestPin.distanceMiles) : `${fieldPins.length}`}</strong>
          saved pins
        </span>
        <span>
          <strong>{activeTrack ? `${activeTrack.points.length} pts` : `${walkTracks.length}`}</strong>
          {activeTrack ? `${formatMiles(activeTrackDistance)} walked` : 'saved walks'}
        </span>
      </div>
    </section>
  );
}

function MobileFieldBar({
  activeTrack,
  isLocating,
  onDropPin,
  onQuickLog,
  onToggleTrack,
  onUseLocation,
}: {
  activeTrack: WalkTrack | null;
  isLocating: boolean;
  onDropPin: () => void;
  onQuickLog: () => void;
  onToggleTrack: () => void;
  onUseLocation: () => void;
}) {
  return (
    <nav className="mobile-field-bar" aria-label="Field actions">
      <button type="button" onClick={onUseLocation} disabled={isLocating}>
        {isLocating ? <LoaderCircle className="spin" size={18} /> : <LocateFixed size={18} />}
        <span>GPS</span>
      </button>
      <button type="button" onClick={onDropPin} disabled={isLocating}>
        <MapPinned size={18} />
        <span>Pin</span>
      </button>
      <button type="button" onClick={onToggleTrack} className={activeTrack ? 'is-tracking' : ''}>
        <Route size={18} />
        <span>{activeTrack ? 'Stop' : 'Walk'}</span>
      </button>
      <button type="button" onClick={onQuickLog}>
        <NotebookPen size={18} />
        <span>Log</span>
      </button>
    </nav>
  );
}

function DataStatusPanel({
  customSources,
  fieldPins,
  logs,
  providerSettings,
  walkTracks,
}: {
  customSources: CustomDataSource[];
  fieldPins: FieldPin[];
  logs: FieldLog[];
  providerSettings: MapProviderSettings;
  walkTracks: WalkTrack[];
}) {
  const latestLog = logs
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  const fieldLogDetail = latestLog
    ? `${logs.length} saved · last log ${formatDate(latestLog.date)}`
    : 'No browser field logs yet';
  const sourceRows = [
    ...DATA_SOURCE_STATUS,
    {
      name: 'Field pins / walk tracks',
      status: 'Local',
      detail: `${fieldPins.length} pins · ${walkTracks.length} saved walks`,
      tone: 'local' as const,
    },
    {
      name: 'Rockhounding.org monitor',
      status: 'Daily cron',
      detail: `${ROCKHOUNDING_ORG_LOCATIONS.length} community pins in baseline; Vercel checks for new or changed pins daily.`,
      tone: 'custom' as const,
    },
    {
      name: 'Optional imagery providers',
      status: [providerSettings.mapboxToken, providerSettings.maptilerKey, providerSettings.customTileUrl].some(Boolean)
        ? 'Configured'
        : 'Optional',
      detail: 'ArcGIS, Mapbox, MapTiler, and custom tile settings live in this browser.',
      tone: 'custom' as const,
    },
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
  providerSettings,
  sources,
  onAdd,
  onChange,
  onProviderChange,
  onRemove,
}: {
  draft: {
    name: string;
    type: CustomDataSource['type'];
    url: string;
    notes: string;
  };
  providerSettings: MapProviderSettings;
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
  onProviderChange: React.Dispatch<React.SetStateAction<MapProviderSettings>>;
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

      <ProviderSettingsForm settings={providerSettings} onChange={onProviderChange} />

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

function ProviderSettingsForm({
  settings,
  onChange,
}: {
  settings: MapProviderSettings;
  onChange: React.Dispatch<React.SetStateAction<MapProviderSettings>>;
}) {
  const providerRows = [
    { label: 'ArcGIS World Imagery', configured: true, detail: 'Public imagery layer available without a key.' },
    { label: 'Mapbox Satellite', configured: Boolean(settings.mapboxToken.trim()), detail: 'Paste a Mapbox access token.' },
    { label: 'MapTiler Satellite', configured: Boolean(settings.maptilerKey.trim()), detail: 'Paste a MapTiler API key.' },
    { label: 'Custom imagery URL', configured: Boolean(settings.customTileUrl.trim()), detail: 'XYZ tile template with {z}/{x}/{y}.' },
  ];

  return (
    <div className="provider-settings">
      <div className="provider-heading">
        <strong>Imagery providers</strong>
        <span>Keys stay in this browser</span>
      </div>

      <div className="provider-status-list">
        {providerRows.map((provider) => (
          <div key={provider.label} className="provider-status-row">
            <i className={provider.configured ? 'is-ready' : ''} aria-hidden="true" />
            <div>
              <strong>{provider.label}</strong>
              <span>{provider.detail}</span>
            </div>
            <em>{provider.configured ? 'Ready' : 'Setup'}</em>
          </div>
        ))}
      </div>

      <label>
        ArcGIS API key
        <input
          value={settings.arcgisKey}
          onChange={(event) => onChange((current) => ({ ...current, arcgisKey: event.target.value }))}
          placeholder="Optional"
          type="password"
        />
      </label>
      <label>
        Mapbox token
        <input
          value={settings.mapboxToken}
          onChange={(event) => onChange((current) => ({ ...current, mapboxToken: event.target.value }))}
          placeholder="pk..."
          type="password"
        />
      </label>
      <label>
        MapTiler key
        <input
          value={settings.maptilerKey}
          onChange={(event) => onChange((current) => ({ ...current, maptilerKey: event.target.value }))}
          placeholder="Optional"
          type="password"
        />
      </label>
      <label>
        Custom XYZ tile URL
        <input
          value={settings.customTileUrl}
          onChange={(event) => onChange((current) => ({ ...current, customTileUrl: event.target.value }))}
          placeholder="https://tiles.example.com/{z}/{x}/{y}.jpg"
          type="text"
        />
      </label>
      <label>
        Custom attribution
        <input
          value={settings.customAttribution}
          onChange={(event) => onChange((current) => ({ ...current, customAttribution: event.target.value }))}
          placeholder="County GIS, state imagery, etc."
          type="text"
        />
      </label>
      <p>
        Optional providers may have account, quota, or billing rules. Keep USGS as the field-safe default unless Gwen
        intentionally configures a provider.
      </p>
    </div>
  );
}

function FieldNotebookPanel({
  activeTrack,
  fieldPins,
  walkTracks,
  onRemovePin,
  onRemoveTrack,
  onSelectPin,
}: {
  activeTrack: WalkTrack | null;
  fieldPins: FieldPin[];
  walkTracks: WalkTrack[];
  onRemovePin: (id: string) => void;
  onRemoveTrack: (id: string) => void;
  onSelectPin: (pin: FieldPin) => void;
}) {
  return (
    <section className="field-notebook-panel" aria-label="Field notebook">
      <div className="panel-heading compact">
        <div>
          <p className="eyeline">Field notebook</p>
          <h2>Pins and walks</h2>
        </div>
        <NotebookPen size={18} />
      </div>

      <div className="field-notebook-summary">
        <span>
          <strong>{fieldPins.length}</strong>
          pins
        </span>
        <span>
          <strong>{walkTracks.length}</strong>
          walks
        </span>
        <span>
          <strong>{activeTrack ? formatMiles(getTrackDistanceMiles(activeTrack.points)) : 'off'}</strong>
          tracking
        </span>
      </div>

      {activeTrack && (
        <article className="field-record is-active">
          <div>
            <strong>{activeTrack.label}</strong>
            <span>{activeTrack.points.length} GPS points · {formatMiles(getTrackDistanceMiles(activeTrack.points))}</span>
          </div>
          <em>Live</em>
        </article>
      )}

      <div className="field-record-list">
        {fieldPins.slice(0, 5).map((pin) => (
          <article key={pin.id} className="field-record">
            <button type="button" onClick={() => onSelectPin(pin)}>
              <strong>{pin.label}</strong>
              <span>
                {pin.materialGuess} · {formatDate(pin.createdAt)} · {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
              </span>
            </button>
            <button type="button" aria-label={`Remove ${pin.label}`} onClick={() => onRemovePin(pin.id)}>
              <Trash2 size={14} />
            </button>
          </article>
        ))}

        {walkTracks.slice(0, 4).map((track) => (
          <article key={track.id} className="field-record">
            <div>
              <strong>{track.label}</strong>
              <span>{formatMiles(track.distanceMiles)} · {track.points.length} GPS points</span>
            </div>
            <button type="button" aria-label={`Remove ${track.label}`} onClick={() => onRemoveTrack(track.id)}>
              <Trash2 size={14} />
            </button>
          </article>
        ))}
      </div>

      {!fieldPins.length && !walkTracks.length && !activeTrack && (
        <p className="empty-state">No field pins or walks yet. Use GPS, drop a pin, or start a walk from the mobile field bar.</p>
      )}
    </section>
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

function optionalBasemapTiles(id: BasemapId, settings: MapProviderSettings): string[] | null {
  if (id === 'arcgis') {
    const token = settings.arcgisKey.trim();
    return [
      `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    ];
  }
  if (id === 'mapbox' && settings.mapboxToken.trim()) {
    return [
      `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${encodeURIComponent(settings.mapboxToken.trim())}`,
    ];
  }
  if (id === 'maptiler' && settings.maptilerKey.trim()) {
    return [
      `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${encodeURIComponent(settings.maptilerKey.trim())}`,
    ];
  }
  if (id === 'custom' && settings.customTileUrl.trim()) {
    return [settings.customTileUrl.trim()];
  }

  return null;
}

function optionalBasemapAttribution(id: BasemapId, settings: MapProviderSettings) {
  if (id === 'arcgis') return 'Esri, Maxar, Earthstar Geographics, and contributors';
  if (id === 'mapbox') return 'Mapbox satellite imagery';
  if (id === 'maptiler') return 'MapTiler satellite imagery';
  if (id === 'custom') return settings.customAttribution.trim() || 'Custom imagery layer';
  return '';
}

function syncOptionalBasemapLayer(map: MapLibreMap, option: BasemapOption, settings: MapProviderSettings) {
  const tiles = optionalBasemapTiles(option.id, settings);

  if (map.getLayer(option.layerId)) {
    map.removeLayer(option.layerId);
  }
  if (map.getSource(option.layerId)) {
    map.removeSource(option.layerId);
  }

  if (!tiles) return;

  map.addSource(option.layerId, {
    type: 'raster',
    tiles,
    tileSize: 256,
    maxzoom: option.nativeZoom,
    attribution: optionalBasemapAttribution(option.id, settings),
  });
  map.addLayer(
    {
      id: option.layerId,
      type: 'raster',
      source: option.layerId,
      layout: {
        visibility: 'none',
      },
      paint: {
        'raster-contrast': -0.04,
        'raster-brightness-min': 0.03,
        'raster-brightness-max': 0.96,
      },
    },
    map.getLayer('wyoming-frame-fill') ? 'wyoming-frame-fill' : undefined,
  );
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

function fieldPinsData(pins: FieldPin[]): MapFeatureCollection {
  return featureCollection(
    pins.map((pin) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
      properties: {
        id: pin.id,
        label: pin.label,
        materialGuess: pin.materialGuess,
        returnWorthy: pin.returnWorthy,
      },
    })),
  );
}

function communityReferenceData(locations: CommunityReferenceLocation[]): MapFeatureCollection {
  return featureCollection(
    locations.map((location) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
      properties: {
        id: location.id,
        slug: location.slug,
        name: location.name,
        foundHere: location.foundHere.slice(0, 8).join(', '),
        locationType: location.locationType,
        sourceUrl: location.sourceUrl,
      },
    })),
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function walkTracksData(walkTracks: WalkTrack[], activeTrack: WalkTrack | null): MapFeatureCollection {
  const savedFeatures = walkTracks
    .filter((track) => track.points.length > 1)
    .map<MapFeature>((track) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: track.points.map((point) => [point.lng, point.lat]) },
      properties: {
        id: track.id,
        active: false,
        label: track.label,
      },
    }));
  const activeFeature =
    activeTrack && activeTrack.points.length > 1
      ? [
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: activeTrack.points.map((point) => [point.lng, point.lat]),
            },
            properties: {
              id: activeTrack.id,
              active: true,
              label: activeTrack.label,
            },
          },
        ]
      : [];

  return featureCollection([...savedFeatures, ...activeFeature]);
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
  activeTrack,
  communityLocations,
  fieldPins,
  filteredHotspots,
  layers,
  providerSettings,
  selectedId,
  userLocation,
  searchRadiusMiles,
  walkTracks,
  onSelect,
}: {
  activeBasemap: BasemapId;
  activeTrack: WalkTrack | null;
  communityLocations: CommunityReferenceLocation[];
  fieldPins: FieldPin[];
  filteredHotspots: Hotspot[];
  layers: LayerToggleState;
  providerSettings: MapProviderSettings;
  selectedId: string;
  userLocation: UserLocation | null;
  searchRadiusMiles: number;
  walkTracks: WalkTrack[];
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
    getAvailableBasemaps(providerSettings).find((option) => option.id === activeBasemap && isBasemapConfigured(option)) ??
    BUILT_IN_BASEMAP_OPTIONS[0];

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

      map.addSource('walk-tracks', { type: 'geojson', data: featureCollection() });
      map.addLayer({
        id: 'walk-tracks',
        type: 'line',
        source: 'walk-tracks',
        paint: {
          'line-color': ['case', ['==', ['get', 'active'], true], '#cf7b48', '#45738f'],
          'line-opacity': ['case', ['==', ['get', 'active'], true], 0.88, 0.62],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 5.5],
        },
      });

      map.addSource('field-pins', { type: 'geojson', data: featureCollection() });
      map.addLayer({
        id: 'field-pins',
        type: 'circle',
        source: 'field-pins',
        paint: {
          'circle-color': ['case', ['==', ['get', 'returnWorthy'], true], '#cf7b48', '#45738f'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 6, 12, 12],
          'circle-stroke-color': '#fffaf1',
          'circle-stroke-width': 2.4,
          'circle-opacity': 0.95,
        },
      });

      map.addSource('community-sites', { type: 'geojson', data: featureCollection() });
      map.addLayer({
        id: 'community-sites',
        type: 'circle',
        source: 'community-sites',
        paint: {
          'circle-color': '#d8c78b',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.52, 10, 0.86],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.2, 10, 7.5],
          'circle-stroke-color': '#26332c',
          'circle-stroke-opacity': 0.62,
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 1.4],
        },
      });

      map.on('click', 'community-sites', (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const coordinates = (feature.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
        const properties = feature.properties ?? {};

        new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
          .setLngLat(coordinates)
          .setHTML(`
            <strong>${escapeHtml(properties.name)}</strong>
            <span>${escapeHtml(properties.locationType)}</span>
            <em>${escapeHtml(properties.foundHere)}</em>
            <a href="${escapeHtml(properties.sourceUrl)}" target="_blank" rel="noreferrer">Open source pin</a>
          `)
          .addTo(map);
      });
      map.on('mouseenter', 'community-sites', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'community-sites', () => {
        map.getCanvas().style.cursor = '';
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

    OPTIONAL_BASEMAP_OPTIONS.forEach((option) => syncOptionalBasemapLayer(map, option, providerSettings));
    BASEMAP_LAYER_IDS.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(layerId, 'visibility', layerId === activeBasemapOption.layerId ? 'visible' : 'none');
    });
  }, [activeBasemapOption.layerId, mapReady, providerSettings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    setSourceData(
      map,
      'geology-signal',
      featureCollection(
        filteredHotspots.map((hotspot) =>
          buildHotspotFeature(hotspot, {
            color: hotspot.targetMaterials.includes('Kimberlite / lamproite')
              ? '#686199'
              : hotspot.targetMaterials.includes('Jade')
                ? '#5f8165'
                : hotspot.targetMaterials.includes('Petrified wood')
                  ? '#b45f35'
                  : '#45738f',
            stroke: hotspot.targetMaterials.includes('Kimberlite / lamproite')
              ? '#47416f'
              : hotspot.targetMaterials.includes('Jade')
                ? '#3c6145'
                : '#4f6e80',
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
    setSourceData(map, 'community-sites', communityReferenceData(communityLocations));

    setLayerVisibility(map, ['geology-signal'], layers.geology);
    setLayerVisibility(map, ['access-signal'], layers.publicLand);
    setLayerVisibility(map, ['claim-signal'], layers.claims);
    setLayerVisibility(map, ['research-routes'], layers.roads);
    setLayerVisibility(map, ['community-sites'], layers.communitySites);
  }, [communityLocations, filteredHotspots, layers, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    setSourceData(map, 'field-pins', fieldPinsData(fieldPins));
    setSourceData(map, 'walk-tracks', walkTracksData(walkTracks, activeTrack));
  }, [activeTrack, fieldPins, mapReady, walkTracks]);

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
        <span>
          {visibleIds.size} targets · {communityLocations.length} refs
        </span>
      </div>
    </div>
  );
}

function Inspector({
  hotspot,
  score,
  selectedDistanceMiles,
  logs,
  onOpenLog,
}: {
  hotspot: Hotspot;
  score: number;
  selectedDistanceMiles: number | null;
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

      {selectedDistanceMiles !== null && (
        <div className="distance-card">
          <Navigation size={17} />
          <div>
            <span>Distance from your location</span>
            <strong>{formatMiles(selectedDistanceMiles)} to selected candidate</strong>
          </div>
        </div>
      )}

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
