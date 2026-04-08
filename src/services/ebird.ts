import { get, set } from 'idb-keyval';

const EBIRD_API_BASE = 'https://api.ebird.org/v2';

export interface EbirdObservation {
  speciesCode: string;
  comName: string;
  sciName: string;
  locId: string;
  locName: string;
  obsDt: string;
  howMany: number;
  lat: number;
  lng: number;
  obsValid: boolean;
  obsReviewed: boolean;
  locationPrivate: boolean;
  subId: string;
}

export interface TaxonomyEntry {
  sciName: string;
  comName: string;
  speciesCode: string;
  category: string;
  taxonOrder: number;
  order: string;
  familyComName: string;
  familySciName: string;
}

export const fetchTaxonomy = async (apiKey: string): Promise<Record<string, TaxonomyEntry>> => {
  const CACHE_KEY = 'ebird-taxonomy-zh-sim-v3';
  const cached = await get(CACHE_KEY);
  if (cached) {
    return cached as Record<string, TaxonomyEntry>;
  }

  const response = await fetch(`${EBIRD_API_BASE}/ref/taxonomy/ebird?fmt=json&locale=zh_SIM`, {
    headers: { 'X-eBirdApiToken': apiKey },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch taxonomy');
  }

  const data: TaxonomyEntry[] = await response.json();
  const taxonomyMap: Record<string, TaxonomyEntry> = {};
  data.forEach((entry) => {
    taxonomyMap[entry.speciesCode] = entry;
  });

  await set(CACHE_KEY, taxonomyMap);
  return taxonomyMap;
};

export const fetchRecentObservations = async (
  apiKey: string,
  lat: number,
  lng: number,
  dist: number = 25,
  back: number = 14
): Promise<EbirdObservation[]> => {
  const response = await fetch(
    `${EBIRD_API_BASE}/data/obs/geo/recent?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}&sppLocale=zh_SIM`,
    { headers: { 'X-eBirdApiToken': apiKey } }
  );
  if (!response.ok) throw new Error('Failed to fetch observations');
  return response.json();
};

export const fetchNotableObservations = async (
  apiKey: string,
  lat: number,
  lng: number,
  dist: number = 25,
  back: number = 14
): Promise<EbirdObservation[]> => {
  const response = await fetch(
    `${EBIRD_API_BASE}/data/obs/geo/recent/notable?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}&sppLocale=zh_SIM`,
    { headers: { 'X-eBirdApiToken': apiKey } }
  );
  if (!response.ok) throw new Error('Failed to fetch notable observations');
  return response.json();
};

export const fetchSpeciesObservations = async (
  apiKey: string,
  speciesCode: string,
  lat: number,
  lng: number,
  dist: number = 25,
  back: number = 14
): Promise<EbirdObservation[]> => {
  const response = await fetch(
    `${EBIRD_API_BASE}/data/obs/geo/recent/${speciesCode}?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}&sppLocale=zh_SIM`,
    { headers: { 'X-eBirdApiToken': apiKey } }
  );
  if (!response.ok) throw new Error(`Failed to fetch observations for ${speciesCode}`);
  return response.json();
};
