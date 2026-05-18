import type { Hotspot, ScoreBand, ScoreFactors } from './types';

export function calculateRockScore(factors: ScoreFactors): number {
  const weighted =
    factors.geology * 8 +
    factors.mineralEvidence * 5 +
    factors.access * 5 +
    factors.roadProximity * 3 +
    factors.personalHistory * 2 -
    factors.claimPenalty * 5 -
    factors.terrainPenalty;

  return Math.max(0, Math.min(100, Math.round(weighted)));
}

export function getScoreBand(hotspot: Hotspot): ScoreBand {
  if (hotspot.accessStatus === 'Restricted / no-go') {
    return 'No-go';
  }

  const score = calculateRockScore(hotspot.scoreFactors);

  if (score >= 80) return 'Priority';
  if (score >= 62) return 'Promising';
  return 'Research';
}

export function getScoreTone(score: number): 'hot' | 'good' | 'watch' | 'blocked' {
  if (score >= 80) return 'hot';
  if (score >= 62) return 'good';
  if (score >= 40) return 'watch';
  return 'blocked';
}

export function explainScore(factors: ScoreFactors): string[] {
  const notes: string[] = [];

  if (factors.geology >= 4) notes.push('Strong geology fit');
  if (factors.mineralEvidence >= 4) notes.push('Known nearby mineral evidence');
  if (factors.access >= 4) notes.push('Favorable public-land signal');
  if (factors.roadProximity >= 4) notes.push('Efficient road approach');
  if (factors.personalHistory >= 3) notes.push('Positive field-history weight');
  if (factors.claimPenalty >= 2) notes.push('Claim status needs verification');
  if (factors.terrainPenalty >= 3) notes.push('Terrain can slow field validation');

  return notes.length ? notes : ['Balanced but unproven research target'];
}
