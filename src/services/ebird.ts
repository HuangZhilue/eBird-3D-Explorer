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
  userDisplayName?: string;
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

export const fetchRegionCode = async (
  apiKey: string,
  lat: number,
  lng: number,
  regionType: 'subnational1' | 'subnational2' = 'subnational1'
): Promise<{ code: string; name: string } | null> => {
  const response = await fetch(
    `${EBIRD_API_BASE}/ref/geo/pos/${regionType}/${lat}/${lng}`,
    { headers: { 'X-eBirdApiToken': apiKey } }
  );
  if (!response.ok) return null;
  const data = await response.json();
  if (data && data.length > 0) {
    return { code: data[0].code, name: data[0].name };
  }
  return null;
};

export const fetchRegionObservations = async (
  apiKey: string,
  regionCode: string,
  back: number = 14
): Promise<EbirdObservation[]> => {
  const response = await fetch(
    `${EBIRD_API_BASE}/data/obs/${regionCode}/recent?back=${back}&sppLocale=zh_SIM`,
    { headers: { 'X-eBirdApiToken': apiKey } }
  );
  if (!response.ok) throw new Error('Failed to fetch region observations');
  return response.json();
};

export const fetchRegionNotableObservations = async (
  apiKey: string,
  regionCode: string,
  back: number = 14
): Promise<EbirdObservation[]> => {
  const response = await fetch(
    `${EBIRD_API_BASE}/data/obs/${regionCode}/recent/notable?back=${back}&sppLocale=zh_SIM`,
    { headers: { 'X-eBirdApiToken': apiKey } }
  );
  if (!response.ok) throw new Error('Failed to fetch region notable observations');
  return response.json();
};

export const fetchRegionGeoJSON = async (regionCode: string): Promise<any> => {
  // Mapping eBird region codes to China adcodes for GeoJSON fetching
  const regionToAdcode: Record<string, string> = {
    'CN-AH': '340000', 'CN-BJ': '110000', 'CN-CQ': '500000', 'CN-FJ': '350000',
    'CN-GD': '440000', 'CN-GS': '620000', 'CN-GX': '450000', 'CN-GZ': '520000',
    'CN-HA': '410000', 'CN-HB': '420000', 'CN-HE': '130000', 'CN-HI': '460000',
    'CN-HL': '230000', 'CN-HN': '430000', 'CN-JL': '220000', 'CN-JS': '320000',
    'CN-JX': '360000', 'CN-LN': '210000', 'CN-NM': '150000', 'CN-NX': '640000',
    'CN-QH': '630000', 'CN-SC': '510000', 'CN-SD': '370000', 'CN-SH': '310000',
    'CN-SN': '610000', 'CN-SX': '140000', 'CN-TJ': '120000', 'CN-XJ': '650000',
    'CN-XZ': '540000', 'CN-YN': '530000', 'CN-ZJ': '330000', 'CN-TW': '710000',
    'CN-HK': '810000', 'CN-MO': '820000'
  };

  const adcode = regionToAdcode[regionCode];
  if (!adcode) return null;

  try {
    const response = await fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`);
    if (!response.ok) {
      // Try without _full for municipalities
      const altResponse = await fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}.json`);
      if (!altResponse.ok) return null;
      return altResponse.json();
    }
    return response.json();
  } catch (err) {
    console.error('Failed to fetch GeoJSON:', err);
    return null;
  }
};
