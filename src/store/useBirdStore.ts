/// <reference types="vite/client" />
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { FlyToInterpolator } from '@deck.gl/core';
import { EbirdObservation, TaxonomyEntry } from '../services/ebird';

export interface HotspotData {
  locId: string;
  locName: string;
  lat: number;
  lng: number;
  observations: EbirdObservation[];
  totalSpecies: number;
  totalIndividuals: number;
  hasNotable: boolean;
  latestReport: string;
}

interface BirdStoreState {
  apiKey: string;
  setApiKey: (key: string) => void;

  observations: EbirdObservation[];
  notableObservations: EbirdObservation[];
  taxonomy: Record<string, TaxonomyEntry>;
  blacklist: string[];
  selectedSpecies: string[];
  seenSpeciesCodes: string[];
  speciesDetailsCache: Record<string, EbirdObservation[]>;
  
  lat: number;
  lng: number;
  radius: number;
  daysBack: number;
  searchMode: 'radius' | 'region';
  regionCode: string;
  regionName: string;
  
  viewState: {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
    transitionDuration?: number;
    transitionInterpolator?: any;
  };
  setViewState: (viewState: any) => void;
  flyTo: (lng: number, lat: number) => void;
  
  isHeatmap: boolean;
  showRadiusMask: boolean;
  mapStyle: 'dark' | 'light' | 'satellite';
  useChinaOffset: boolean;
  visualScale: number;
  heightScale: number;
  
  setObservations: (obs: EbirdObservation[]) => void;
  setNotableObservations: (obs: EbirdObservation[]) => void;
  setTaxonomy: (tax: Record<string, TaxonomyEntry>) => void;
  setBlacklist: (list: string[]) => void;
  setSelectedSpecies: (species: string[]) => void;
  toggleSpeciesSelection: (speciesCode: string) => void;
  selectAllSpecies: () => void;
  deselectAllSpecies: () => void;
  
  setSearchParams: (params: Partial<{ lat: number; lng: number; radius: number; daysBack: number }>) => void;
  setIsHeatmap: (isHeatmap: boolean) => void;
  setShowRadiusMask: (show: boolean) => void;
  setMapStyle: (style: 'dark' | 'light' | 'satellite') => void;
  setUseChinaOffset: (use: boolean) => void;
  setVisualScale: (scale: number) => void;
  setHeightScale: (scale: number) => void;
  setSearchMode: (mode: 'radius' | 'region') => void;
  setRegion: (code: string, name: string) => void;
  
  getAggregatedData: () => HotspotData[];
  updateSpeciesCache: (code: string, details: EbirdObservation[]) => void;
  cleanupCache: () => void;
}

export const useBirdStore = create<BirdStoreState>()(
  persist(
    (set, get) => ({
      apiKey: import.meta.env.VITE_EBIRD_API_KEY || '',
      setApiKey: (key) => set({ apiKey: key }),

      observations: [],
      notableObservations: [],
      taxonomy: {},
      blacklist: [],
      selectedSpecies: [],
      seenSpeciesCodes: [],
      speciesDetailsCache: {},
      
      lat: 39.9042, // Default Beijing
      lng: 116.4074,
      radius: 25,
      daysBack: 14,
      searchMode: 'radius',
      regionCode: '',
      regionName: '',
      
      viewState: {
        longitude: 116.4074,
        latitude: 39.9042,
        zoom: 10,
        pitch: 45,
        bearing: 0
      },
      setViewState: (viewState) => set({ viewState }),
      
      flyTo: (lng: number, lat: number) => set((state) => ({
        viewState: {
          ...state.viewState,
          longitude: lng,
          latitude: lat,
          zoom: 14,
          transitionDuration: 1500,
          transitionInterpolator: new FlyToInterpolator()
        }
      })),
      
      isHeatmap: false,
      showRadiusMask: true,
      mapStyle: 'dark',
      useChinaOffset: false,
      visualScale: 1.0,
      heightScale: 1.0,
      
      setObservations: (obs) => {
        const { blacklist, selectedSpecies, seenSpeciesCodes } = get();
        const currentFetchSpecies = Array.from(new Set(obs.map(o => o.speciesCode))).filter(code => !blacklist.includes(code));
        
        if (seenSpeciesCodes.length === 0) {
          // First time ever getting data: select everything found
          set({ 
            observations: obs, 
            selectedSpecies: currentFetchSpecies,
            seenSpeciesCodes: currentFetchSpecies 
          });
        } else {
          // We have seen species before. 
          // 1. Keep ALL currently selected species (don't filter out those missing from current fetch)
          // 2. Add brand new species that we've NEVER encountered before in any fetch
          const seenSet = new Set(seenSpeciesCodes);
          const brandNewSpecies = currentFetchSpecies.filter(c => !seenSet.has(c));
          
          const updatedSelected = Array.from(new Set([...selectedSpecies, ...brandNewSpecies]));
          
          set({ 
            observations: obs, 
            selectedSpecies: updatedSelected,
            seenSpeciesCodes: Array.from(new Set([...seenSpeciesCodes, ...currentFetchSpecies]))
          });
        }
        // Run cleanup on every new observation set
        get().cleanupCache();
      },
      setNotableObservations: (obs) => set({ notableObservations: obs }),
      setTaxonomy: (tax) => set({ taxonomy: tax }),
      setBlacklist: (list) => set({ blacklist: list }),
      setSelectedSpecies: (species) => set({ selectedSpecies: species }),
      toggleSpeciesSelection: (speciesCode) => set((state) => ({
        selectedSpecies: state.selectedSpecies.includes(speciesCode)
          ? state.selectedSpecies.filter(s => s !== speciesCode)
          : [...state.selectedSpecies, speciesCode]
      })),
      selectAllSpecies: () => set((state) => {
        const uniqueSpecies = Array.from(new Set(state.observations.map(o => o.speciesCode))).filter(code => !state.blacklist.includes(code));
        return { selectedSpecies: uniqueSpecies };
      }),
      deselectAllSpecies: () => set({ selectedSpecies: [] }),
      
      setSearchParams: (params) => set((state) => ({ ...state, ...params })),
      setIsHeatmap: (isHeatmap) => set({ isHeatmap }),
      setShowRadiusMask: (showRadiusMask) => set({ showRadiusMask }),
      setMapStyle: (mapStyle) => set({ mapStyle }),
      setUseChinaOffset: (useChinaOffset) => set({ useChinaOffset }),
      setVisualScale: (visualScale) => set({ visualScale }),
      setHeightScale: (heightScale) => set({ heightScale }),
      setSearchMode: (searchMode) => set({ searchMode }),
      setRegion: (regionCode, regionName) => set({ regionCode, regionName }),
      
      updateSpeciesCache: (code, details) => set((state) => ({
        speciesDetailsCache: { ...state.speciesDetailsCache, [code]: details }
      })),

      cleanupCache: () => {
        const { speciesDetailsCache } = get();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const newCache: Record<string, EbirdObservation[]> = {};
        let changed = false;

        Object.entries(speciesDetailsCache).forEach(([code, records]) => {
          const validRecords = records.filter(r => new Date(r.obsDt) > thirtyDaysAgo);
          if (validRecords.length !== records.length) {
            changed = true;
          }
          if (validRecords.length > 0) {
            newCache[code] = validRecords;
          } else {
            changed = true;
          }
        });

        if (changed) {
          set({ speciesDetailsCache: newCache });
        }
      },

      getAggregatedData: () => {
        const { observations, notableObservations, blacklist, selectedSpecies, speciesDetailsCache } = get();
        
        const notableCodes = new Set(notableObservations.map(o => o.speciesCode));
        
        // Use cached details if available for selected species, otherwise fallback to the single observation
        const allObs: EbirdObservation[] = [];
        observations.forEach(obs => {
          if (blacklist.includes(obs.speciesCode) || !selectedSpecies.includes(obs.speciesCode)) return;
          
          const cached = speciesDetailsCache[obs.speciesCode];
          if (cached && cached.length > 0) {
            allObs.push(...cached);
          } else {
            allObs.push(obs);
          }
        });
        
        // Group by location
        const hotspotsMap = new Map<string, HotspotData>();
        
        allObs.forEach(obs => {
          if (!hotspotsMap.has(obs.locId)) {
            hotspotsMap.set(obs.locId, {
              locId: obs.locId,
              locName: obs.locName,
              lat: obs.lat,
              lng: obs.lng,
              observations: [],
              totalSpecies: 0,
              totalIndividuals: 0,
              hasNotable: false,
              latestReport: obs.obsDt
            });
          }
          
          const hotspot = hotspotsMap.get(obs.locId)!;
          hotspot.observations.push(obs);
          
          hotspot.totalIndividuals += (obs.howMany || 1);
          if (notableCodes.has(obs.speciesCode)) {
            hotspot.hasNotable = true;
          }
          if (new Date(obs.obsDt) > new Date(hotspot.latestReport)) {
            hotspot.latestReport = obs.obsDt;
          }
        });
        
        hotspotsMap.forEach(hotspot => {
          const uniqueSpecies = new Set(hotspot.observations.map(o => o.speciesCode));
          hotspot.totalSpecies = uniqueSpecies.size;
        });
        
        return Array.from(hotspotsMap.values());
      }
    }),
    {
      name: 'ebird-explorer-storage',
      storage: createJSONStorage(() => localStorage),
      // Only persist these fields
      partialize: (state) => ({
        apiKey: state.apiKey,
        lat: state.lat,
        lng: state.lng,
        radius: state.radius,
        daysBack: state.daysBack,
        selectedSpecies: state.selectedSpecies,
        seenSpeciesCodes: state.seenSpeciesCodes,
        speciesDetailsCache: state.speciesDetailsCache,
        isHeatmap: state.isHeatmap,
        showRadiusMask: state.showRadiusMask,
        mapStyle: state.mapStyle,
        useChinaOffset: state.useChinaOffset,
        visualScale: state.visualScale,
        heightScale: state.heightScale,
        searchMode: state.searchMode,
        regionCode: state.regionCode,
        regionName: state.regionName,
        viewState: state.viewState,
      }),
    }
  )
);
