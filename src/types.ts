export type Material =
  | 'Agate'
  | 'Jasper'
  | 'Jade'
  | 'Petrified wood'
  | 'Quartz'
  | 'Fossil caution'
  | 'Gold indicators'
  | 'Unusual minerals';

export type AccessStatus = 'Likely public' | 'Verify access' | 'Private risk' | 'Restricted / no-go';

export type ClaimRisk = 'Low' | 'Medium' | 'High' | 'Unknown';

export type ScoreBand = 'Priority' | 'Promising' | 'Research' | 'No-go';

export interface ScoreFactors {
  geology: number;
  mineralEvidence: number;
  access: number;
  roadProximity: number;
  personalHistory: number;
  claimPenalty: number;
  terrainPenalty: number;
}

export interface Hotspot {
  id: string;
  name: string;
  county: string;
  lat: number;
  lng: number;
  targetMaterials: Material[];
  geologyUnit: string;
  landManager: string;
  accessStatus: AccessStatus;
  claimRisk: ClaimRisk;
  roadProximity: string;
  terrain: string;
  evidence: string[];
  cautions: string[];
  sourceNotes: string[];
  scoreFactors: ScoreFactors;
}

export interface FieldLog {
  id: string;
  hotspotId: string;
  date: string;
  materialGuess: Material | 'Unknown';
  quality: number;
  quantity: 'Trace' | 'Small pocket' | 'Productive' | 'Unknown';
  returnWorthy: boolean;
  notes: string;
}

export interface LayerToggleState {
  geology: boolean;
  publicLand: boolean;
  claims: boolean;
  roads: boolean;
  notes: boolean;
}
