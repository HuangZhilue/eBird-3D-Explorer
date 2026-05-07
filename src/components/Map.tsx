import React, { useState, useMemo, useRef, useEffect } from 'react';
// @ts-ignore
import MapboxMap from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { FlyToInterpolator, LinearInterpolator } from '@deck.gl/core';
import { ColumnLayer, GeoJsonLayer } from '@deck.gl/layers';
import { HeatmapLayer as DeckGLHeatmapLayer } from '@deck.gl/aggregation-layers';
import { ScatterplotLayer, PolygonLayer } from '@deck.gl/layers';
import { Compass, Box, Square, MapPin, Map as MapArea, Loader2 } from 'lucide-react';
import { useBirdStore, HotspotData } from '../store/useBirdStore';
import { gcj02ToWgs84 } from '../lib/coord';
import { fetchRegionCode, fetchRegionGeoJSON } from '../services/ebird';
import 'maplibre-gl/dist/maplibre-gl.css';

// Polyfill for WebGL context limits to prevent deck.gl crashes
if (typeof window !== 'undefined') {
  const patchLimits = (Context: any) => {
    if (Context && !Context.prototype.limits) {
      Object.defineProperty(Context.prototype, 'limits', {
        get() {
          return { maxTextureDimension2D: 4096 };
        },
        configurable: true
      });
    }
  };
  patchLimits((window as any).WebGLRenderingContext);
  patchLimits((window as any).WebGL2RenderingContext);
}

// Patch HeatmapLayer to avoid device.limits error
class HeatmapLayer extends DeckGLHeatmapLayer {
  _setupTextureParams() {
    const { device } = this.context as any;
    const { weightsTextureSize } = this.props as any;
    const maxDim = device?.limits?.maxTextureDimension2D || 4096;
    const textureSize = Math.min(weightsTextureSize as number, maxDim);
    const floatSupported = device?.features ? ['float32-renderable-webgl', 'texture-blend-float-webgl'].every(f => device.features.has(f)) : false;
    const format = floatSupported ? 'rgba32float' : 'rgba8unorm';
    const weightsScale = floatSupported ? 1 : 1 / 255;
    this.setState({ textureSize, format, weightsScale });
    if (!floatSupported) {
      console.warn(`HeatmapLayer: ${this.id} rendering to float texture not supported, falling back to low precision format`);
    }
  }
}

const MAP_STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  satellite: {
    version: 8,
    sources: {
      "esri-satellite": {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: "Esri"
      }
    },
    layers: [{ id: "esri-satellite-layer", type: "raster", source: "esri-satellite" }]
  }
};

export default function Map() {
  const { 
    isHeatmap, getAggregatedData, taxonomy, viewState, setViewState, 
    lat, lng, radius, mapStyle, useChinaOffset, showRadiusMask,
    visualScale, heightScale,
    searchMode, setSearchMode, regionCode, regionName, setRegion, apiKey
  } = useBirdStore();
  
  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [lastHoverInfo, setLastHoverInfo] = useState<any>(null);
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, lng: number, lat: number} | null>(null);
  const [regionGeoJSON, setRegionGeoJSON] = useState<any>(null);
  const [isRegionLoading, setIsRegionLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastOpenTime = useRef<number>(0);
  
  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  const pressStartPos = useRef<{x: number, y: number} | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Ignore clicks if the menu was just opened (prevents immediate closing on mouse up)
      if (Date.now() - lastOpenTime.current < 300) return;
      
      // If clicking inside the menu, don't close it
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      
      setContextMenu(null);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('contextmenu', handleClickOutside);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('contextmenu', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (searchMode === 'region' && regionCode) {
      fetchRegionGeoJSON(regionCode).then(setRegionGeoJSON).catch(console.error);
    } else {
      setRegionGeoJSON(null);
    }
  }, [searchMode, regionCode]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    pressStartPos.current = { x: e.clientX, y: e.clientY };
    
    if (pressTimer.current) clearTimeout(pressTimer.current);
    
    pressTimer.current = setTimeout(() => {
      if (lastHoverInfo && lastHoverInfo.coordinate) {
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          lng: lastHoverInfo.coordinate[0],
          lat: lastHoverInfo.coordinate[1]
        });
        lastOpenTime.current = Date.now();
      }
    }, 500);
  };

  const handlePointerUp = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pressStartPos.current) {
      const dx = e.clientX - pressStartPos.current.x;
      const dy = e.clientY - pressStartPos.current.y;
      if (Math.sqrt(dx*dx + dy*dy) > 5) {
        if (pressTimer.current) clearTimeout(pressTimer.current);
      }
    }
  };

  const data = getAggregatedData();

  const diskData = useMemo(() => {
    const disks: any[] = [];
    const Z_STEP = 50 * heightScale;

    data.forEach(hotspot => {
      // We'll show individual records as requested
      const obsList = hotspot.observations.filter(o => o && o.obsDt);

      // Sort for stacking (Bottom to Top)
      // Goal: "Pyramid Stacking" - Larger disks must be below smaller disks to prevent occlusion.
      // Primary Sort: Radius (Count-based) descending
      // Secondary Sort: Rarity (Common -> Uncommon -> Rare)
      // Tertiary Sort: Date (Oldest -> Newest)
      obsList.sort((a, b) => {
        const aNotable = useBirdStore.getState().notableObservations.some(n => n.speciesCode === a.speciesCode);
        const bNotable = useBirdStore.getState().notableObservations.some(n => n.speciesCode === b.speciesCode);
        
        const aUncommon = (a.howMany || 1) <= 3 && !aNotable;
        const bUncommon = (b.howMany || 1) <= 3 && !bNotable;

        const getRadius = (howMany: number) => {
          if (howMany > 15) return 450 * visualScale;
          if (howMany > 8) return 350 * visualScale;
          if (howMany > 3) return 250 * visualScale;
          return 150 * visualScale;
        };

        const radiusA = getRadius(a.howMany || 1);
        const radiusB = getRadius(b.howMany || 1);

        // 1. Sort by Radius Descending (Larger on bottom)
        if (radiusA !== radiusB) return radiusB - radiusA;

        // 2. Within same radius, sort by Rarity (Rare on top)
        const getRarityScore = (isNotable: boolean, isUncommon: boolean) => {
          if (isNotable) return 2;
          if (isUncommon) return 1;
          return 0;
        };
        const scoreA = getRarityScore(aNotable, aUncommon);
        const scoreB = getRarityScore(bNotable, bUncommon);
        if (scoreA !== scoreB) return scoreA - scoreB;

        // 3. Same rarity and radius, sort by date (Newest on top)
        return new Date(a.obsDt).getTime() - new Date(b.obsDt).getTime();
      });

      obsList.forEach((obs: any, index: number) => {
        const isNotable = useBirdStore.getState().notableObservations.some(n => n.speciesCode === obs.speciesCode);
        const isUncommon = (obs.howMany || 1) <= 3 && !isNotable;
        
        let radius = 150 * visualScale;
        if (obs.howMany > 15) radius = 450 * visualScale;
        else if (obs.howMany > 8) radius = 350 * visualScale;
        else if (obs.howMany > 3) radius = 250 * visualScale;

        let color = [34, 197, 94, 200]; // Green (Common)
        if (isNotable) color = [239, 68, 68, 200]; // Red (Rare)
        else if (isUncommon) color = [234, 179, 8, 200]; // Yellow (Uncommon)

        // Apply China Offset if enabled (Inverse transform to move North-West)
        let pos: [number, number] = [hotspot.lng, hotspot.lat];
        if (useChinaOffset) {
          pos = gcj02ToWgs84(hotspot.lng, hotspot.lat);
        }

        disks.push({
          ...obs,
          hotspotName: hotspot.locName,
          position: [...pos, index * Z_STEP],
          radius,
          color
        });
      });
    });
    return disks;
  }, [data, useChinaOffset, visualScale, heightScale]);

  const layers = useMemo(() => {
    const baseLayers = [];

    // Selected location marker
    let centerPos: [number, number] = [lng, lat];
    if (useChinaOffset) {
      centerPos = gcj02ToWgs84(lng, lat);
    }

    // Radius Mask Layer
    if (showRadiusMask && searchMode === 'radius') {
      // Create a large rectangle covering the world with a circular hole
      const worldBounds = [
        [-180, 90],
        [-180, -90],
        [180, -90],
        [180, 90],
        [-180, 90]
      ];

      // Generate points for the circular hole
      const holePoints: [number, number][] = [];
      const numPoints = 64;
      // Convert radius km to degrees approx (at equator 1 deg ~ 111km)
      // For better accuracy we use meters and let deck.gl handle it if possible, 
      // but PolygonLayer uses coordinates. We'll approximate for the mask.
      const radiusDeg = radius / 111.32; 
      const latRad = centerPos[1] * Math.PI / 180;
      const lngDegPerKm = 1 / (111.32 * Math.cos(latRad));
      const radiusLngDeg = radius * lngDegPerKm;
      const radiusLatDeg = radius / 111.32;

      for (let i = 0; i <= numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        holePoints.push([
          centerPos[0] + radiusLngDeg * Math.cos(angle),
          centerPos[1] + radiusLatDeg * Math.sin(angle)
        ]);
      }

      baseLayers.push(
        new PolygonLayer({
          id: 'radius-mask',
          data: [{
            polygon: [worldBounds, holePoints]
          }],
          getPolygon: d => d.polygon,
          getFillColor: [0, 0, 0, 120], // Semi-transparent black
          pickable: false,
          stroked: false,
          filled: true
        })
      );
    }

    // Regional Mask Layer
    if (showRadiusMask && searchMode === 'region' && regionGeoJSON) {
      const worldBounds = [
        [-180, 90],
        [-180, -90],
        [180, -90],
        [180, 90],
        [-180, 90]
      ];

      // Extract all polygons from GeoJSON to create holes
      const holes: [number, number][][] = [];
      
      const processGeometry = (geometry: any) => {
        if (geometry.type === 'Polygon') {
          holes.push(geometry.coordinates[0]);
        } else if (geometry.type === 'MultiPolygon') {
          geometry.coordinates.forEach((poly: any) => {
            holes.push(poly[0]);
          });
        }
      };

      if (regionGeoJSON.type === 'FeatureCollection') {
        regionGeoJSON.features.forEach((f: any) => processGeometry(f.geometry));
      } else if (regionGeoJSON.type === 'Feature') {
        processGeometry(regionGeoJSON.geometry);
      } else {
        processGeometry(regionGeoJSON);
      }

      baseLayers.push(
        new PolygonLayer({
          id: 'region-mask',
          data: [{
            polygon: [worldBounds, ...holes]
          }],
          getPolygon: d => d.polygon,
          getFillColor: [0, 0, 0, 120],
          pickable: false,
          stroked: false,
          filled: true
        })
      );
      
      // Also add a subtle border for the region
      baseLayers.push(
        new GeoJsonLayer({
          id: 'region-border',
          data: regionGeoJSON,
          stroked: true,
          filled: false,
          getLineColor: [59, 130, 246, 200],
          getLineWidth: 2,
          lineWidthMinPixels: 2
        })
      );
    }

    baseLayers.push(
      new ScatterplotLayer({
        id: 'selected-location',
        data: [{ position: centerPos }],
        getPosition: d => d.position,
        getFillColor: [59, 130, 246, 255],
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 2,
        getRadius: 1000,
        radiusMinPixels: 6,
        radiusMaxPixels: 12,
        stroked: true,
        pickable: false,
      })
    );

    if (isHeatmap) {
      baseLayers.push(
        new HeatmapLayer({
          id: 'heatmap-layer',
          data,
          getPosition: (d: HotspotData) => {
            if (useChinaOffset) return gcj02ToWgs84(d.lng, d.lat);
            return [d.lng, d.lat];
          },
          getWeight: (d: HotspotData) => d.totalIndividuals,
          radiusPixels: 30,
          intensity: 1,
          threshold: 0.05
        })
      );
    } else {
      baseLayers.push(
        new ScatterplotLayer({
          id: 'species-disks-layer',
          data: diskData,
          getPosition: d => d.position,
          getFillColor: d => d.color,
          getRadius: d => d.radius,
          radiusUnits: 'meters',
          pickable: true,
          stroked: true,
          getLineColor: [255, 255, 255, 100],
          lineWidthMinPixels: 1,
          onHover: (info) => setHoverInfo(info)
        })
      );
    }

    return baseLayers;
  }, [data, isHeatmap, lat, lng, diskData, useChinaOffset]);

  const getTooltipContent = ({ object }: any) => {
    if (!object) return null;
    
    if (isHeatmap) {
      const d = object as HotspotData;
      const speciesList = Array.from(new Set(d.observations.map(o => o.speciesCode)))
        .map(code => taxonomy[code]?.comName || code)
        .slice(0, 5)
        .join(', ');
      
      return {
        html: `
          <div class="p-2 bg-white text-slate-800 rounded shadow-lg text-sm">
            <div class="font-bold text-base mb-1">${d.locName}</div>
            <div><strong>Total Species:</strong> ${d.totalSpecies}</div>
            <div><strong>Total Individuals:</strong> ${d.totalIndividuals}</div>
            <div><strong>Latest Report:</strong> ${new Date(d.latestReport).toLocaleString()}</div>
            <div class="mt-2 text-xs text-slate-500 max-w-[200px] truncate">
              ${speciesList}${d.totalSpecies > 5 ? '...' : ''}
            </div>
          </div>
        `,
        style: { backgroundColor: 'transparent', padding: '0px' }
      };
    }

    const d = object as any;
    const speciesName = taxonomy[d.speciesCode]?.comName || d.comName || d.speciesCode;
    let status = 'Common';
    let statusColor = 'text-green-600';
    
    const isNotable = useBirdStore.getState().notableObservations.some(n => n.speciesCode === d.speciesCode);
    if (isNotable) {
      status = 'Rare / Notable';
      statusColor = 'text-red-600';
    } else if (d.howMany <= 3) {
      status = 'Uncommon';
      statusColor = 'text-yellow-600';
    }

    return {
      html: `
        <div class="p-2 bg-white text-slate-800 rounded shadow-lg text-sm min-w-[180px]">
          <div class="font-bold text-base mb-1 border-b pb-1">${d.hotspotName}</div>
          <div class="font-medium text-blue-700">${speciesName}</div>
          <div class="flex justify-between items-center mt-1">
            <span class="text-slate-500">Count:</span>
            <span class="font-bold">${d.howMany}</span>
          </div>
          <div class="flex justify-between items-center mt-1">
            <span class="text-slate-500">Status:</span>
            <span class="font-bold ${statusColor}">${status}</span>
          </div>
          <div class="flex justify-between items-center mt-1 border-t pt-1 text-[10px] text-slate-400">
            <span>Time:</span>
            <span>${new Date(d.obsDt).toLocaleString()}</span>
          </div>
        </div>
      `,
      style: { backgroundColor: 'transparent', padding: '0px' }
    };
  };

  return (
    <div 
      className="relative w-full h-full"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerUp}
    >
      <DeckGL
        layers={layers}
        viewState={viewState as any}
        onViewStateChange={({ viewState: newViewState }) => {
          setViewState(newViewState as any);
        }}
        controller={true}
        onHover={(info) => {
          setLastHoverInfo(info);
        }}
        onDeviceInitialized={(device: any) => {
          if (device) {
            if (!device.limits) {
              Object.defineProperty(device, 'limits', {
                value: { maxTextureDimension2D: 4096 },
                writable: true,
                configurable: true
              });
            } else if (device.limits.maxTextureDimension2D === undefined) {
              device.limits.maxTextureDimension2D = 4096;
            }
          }
        }}
        getTooltip={getTooltipContent}
      >
        <MapboxMap
          mapStyle={MAP_STYLES[mapStyle] as any}
          reuseMaps
        />
      </DeckGL>
      
      {/* Map Controls */}
      <div className="absolute right-4 bottom-24 flex flex-col gap-2 z-10">
        <button
          onClick={() => {
            setViewState({
              ...viewState,
              bearing: 0,
              transitionDuration: 1000,
              transitionInterpolator: new LinearInterpolator(['bearing'])
            });
          }}
          className="p-3 bg-white/90 hover:bg-white text-slate-700 rounded-full shadow-lg transition-all active:scale-95 group"
          title="重置指北"
        >
          <Compass className="w-5 h-5 group-hover:text-blue-600" />
        </button>
        
        <button
          onClick={() => {
            setViewState({
              ...viewState,
              pitch: 60,
              transitionDuration: 1000,
              transitionInterpolator: new LinearInterpolator(['pitch'])
            });
          }}
          className={`p-3 rounded-full shadow-lg transition-all active:scale-95 group ${
            viewState.pitch > 45 ? 'bg-blue-600 text-white' : 'bg-white/90 hover:bg-white text-slate-700'
          }`}
          title="3D 视角"
        >
          <Box className="w-5 h-5" />
        </button>

        <button
          onClick={() => {
            setViewState({
              ...viewState,
              pitch: 0,
              transitionDuration: 1000,
              transitionInterpolator: new LinearInterpolator(['pitch'])
            });
          }}
          className={`p-3 rounded-full shadow-lg transition-all active:scale-95 group ${
            viewState.pitch <= 10 ? 'bg-blue-600 text-white' : 'bg-white/90 hover:bg-white text-slate-700'
          }`}
          title="俯视视角"
        >
          <Square className="w-5 h-5" />
        </button>
      </div>
      
      {contextMenu && (
        <div 
          ref={menuRef}
          className="fixed bg-white shadow-lg rounded border border-slate-200 py-1 z-50 text-sm min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-500 font-mono">
            {contextMenu.lat.toFixed(4)}, {contextMenu.lng.toFixed(4)}
          </div>
          
          <button 
            className="w-full text-left px-4 py-2 hover:bg-slate-100 text-slate-700 transition-colors flex items-center gap-2"
            onClick={(e) => {
              e.stopPropagation();
              setSearchMode('radius');
              useBirdStore.getState().setSearchParams({
                lng: Number(contextMenu.lng.toFixed(4)),
                lat: Number(contextMenu.lat.toFixed(4))
              });
              setContextMenu(null);
            }}
          >
            <MapPin className="w-4 h-4 text-blue-500" />
            设为搜索中心点
          </button>

          <button 
            className="w-full text-left px-4 py-2 hover:bg-slate-100 text-slate-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            disabled={isRegionLoading}
            onClick={async (e) => {
              e.stopPropagation();
              if (!apiKey) return alert('请先设置 API Key');
              
              setIsRegionLoading(true);
              try {
                const region = await fetchRegionCode(apiKey, contextMenu.lat, contextMenu.lng);
                if (region) {
                  setRegion(region.code, region.name);
                  setSearchMode('region');
                } else {
                  alert('无法识别该位置的省级区域');
                }
              } catch (err) {
                console.error(err);
                alert('区域查询失败');
              } finally {
                setIsRegionLoading(false);
                setContextMenu(null);
              }
            }}
          >
            {isRegionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapArea className="w-4 h-4 text-green-500" />}
            查询省级区域数据
          </button>
        </div>
      )}
    </div>
  );
}
