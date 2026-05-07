import React, { useEffect, useState } from 'react';
import { useBirdStore } from '../store/useBirdStore';
import { 
  fetchRecentObservations, 
  fetchNotableObservations, 
  fetchTaxonomy, 
  fetchSpeciesObservations,
  fetchRegionObservations,
  fetchRegionNotableObservations
} from '../services/ebird';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Settings, Map as MapIcon, Layers, Search, Loader2, Navigation, ChevronDown, ChevronRight, Menu, X } from 'lucide-react';

export default function Sidebar() {
  const {
    apiKey, setApiKey,
    mapStyle, setMapStyle,
    showRadiusMask, setShowRadiusMask,
    useChinaOffset, setUseChinaOffset,
    visualScale, setVisualScale,
    heightScale, setHeightScale,
    lat, lng, radius, daysBack, setSearchParams,
    searchMode, setSearchMode, regionCode, regionName,
    observations, taxonomy, selectedSpecies, toggleSpeciesSelection,
    selectAllSpecies, deselectAllSpecies,
    setObservations, setNotableObservations, setTaxonomy,
    isHeatmap, setIsHeatmap, flyTo, notableObservations,
    getAggregatedData
  } = useBirdStore();

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isConfigExpanded, setIsConfigExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSpecies, setExpandedSpecies] = useState<Set<string>>(new Set());
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  const { speciesDetailsCache, updateSpeciesCache } = useBirdStore();
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0 });

  // Background loader effect
  useEffect(() => {
    if (observations.length === 0 || !apiKey) return;
    
    let isCancelled = false;
    // Only sync species that are currently selected
    const speciesToSync = Array.from(new Set(observations.map(o => o.speciesCode)))
      .filter(code => selectedSpecies.includes(code));
    
    const loadNeededDetails = async () => {
      setIsBackgroundLoading(true);
      setLoadProgress({ current: 0, total: speciesToSync.length });
      
      for (let i = 0; i < speciesToSync.length; i++) {
        if (isCancelled) break;
        const code = speciesToSync[i];
        
        // Find the latest observation for this species in the current fetch
        const latestObs = observations.find(o => o.speciesCode === code);
        const cached = speciesDetailsCache[code];
        
        // Check if we need to sync:
        // 1. No cache exists
        // 2. The latest observation in cache is older than the one we just fetched
        let needsSync = !cached || cached.length === 0;
        if (cached && latestObs) {
          const validCached = cached.filter(r => r && r.obsDt);
          const cachedLatest = [...validCached].sort((a, b) => new Date(b.obsDt).getTime() - new Date(a.obsDt).getTime())[0];
          if (cachedLatest && new Date(latestObs.obsDt) > new Date(cachedLatest.obsDt)) {
            needsSync = true;
          }
        }

        if (needsSync) {
          try {
            const details = await fetchSpeciesObservations(apiKey, code, lat, lng, radius, daysBack);
            if (!isCancelled) {
              updateSpeciesCache(code, details);
            }
          } catch (err) {
            console.error(`Failed to fetch details for ${code}:`, err);
          }
          // 礼貌性延迟
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        if (!isCancelled) {
          setLoadProgress(prev => ({ ...prev, current: i + 1 }));
        }
      }
      
      if (!isCancelled) setIsBackgroundLoading(false);
    };

    loadNeededDetails();
    return () => { isCancelled = true; };
  }, [observations, selectedSpecies, apiKey, lat, lng, radius, daysBack]);

  const toggleExpand = async (code: string) => {
    const isExpanding = !expandedSpecies.has(code);
    
    // If expanding and no cache, trigger a manual sync for this species
    if (isExpanding && (!speciesDetailsCache[code] || speciesDetailsCache[code].length === 0) && apiKey) {
      try {
        const details = await fetchSpeciesObservations(apiKey, code, lat, lng, radius, daysBack);
        updateSpeciesCache(code, details);
      } catch (err) {
        console.error('Failed to manually fetch species details:', err);
      }
    }

    setExpandedSpecies(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleExpandLocation = (locId: string) => {
    setExpandedLocations(prev => {
      const next = new Set(prev);
      if (next.has(locId)) next.delete(locId);
      else next.add(locId);
      return next;
    });
  };

  useEffect(() => {
    if (apiKey) {
      fetchTaxonomy(apiKey).then(setTaxonomy).catch(console.error);
    }
  }, [apiKey, setTaxonomy]);

  useEffect(() => {
    // Try to get user location on mount
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setSearchParams({ lat: Number(latitude.toFixed(4)), lng: Number(longitude.toFixed(4)) });
          flyTo(longitude, latitude);
        },
        (error) => {
          console.log('Geolocation error or denied:', error.message);
        },
        { timeout: 10000 }
      );
    }
  }, []);

  const handleFetchData = async () => {
    if (!apiKey) return alert('Please enter eBird API Key');
    setLoading(true);
    try {
      let recent, notable;
      if (searchMode === 'region' && regionCode) {
        [recent, notable] = await Promise.all([
          fetchRegionObservations(apiKey, regionCode, daysBack),
          fetchRegionNotableObservations(apiKey, regionCode, daysBack)
        ]);
      } else {
        [recent, notable] = await Promise.all([
          fetchRecentObservations(apiKey, lat, lng, radius, daysBack),
          fetchNotableObservations(apiKey, lat, lng, radius, daysBack)
        ]);
      }
      setObservations(recent);
      setNotableObservations(notable);
    } catch (error) {
      console.error(error);
      alert('Failed to fetch data. Check your API key and parameters.');
    } finally {
      setLoading(false);
    }
  };

  // Compute species stats for the Data tab list
  const speciesStats = React.useMemo(() => {
    const statsMap = new Map<string, {
      code: string,
      name: string,
      isNotable: boolean,
      totalCount: number,
      latestCount: number,
      latestTime: string,
      records: any[]
    }>();

    const notableCodes = new Set(notableObservations.map(o => o.speciesCode));

    observations.forEach(obs => {
      const code = obs.speciesCode;
      const details = speciesDetailsCache[code];
      
      if (!statsMap.has(code)) {
        statsMap.set(code, {
          code,
          name: taxonomy[code]?.comName || code,
          isNotable: notableCodes.has(code),
          totalCount: 0,
          latestCount: 0,
          latestTime: '',
          records: []
        });
      }
      
      const stat = statsMap.get(code)!;
      
      if (details) {
        // Use detailed records if available
        const validDetails = details.filter(r => r && r.obsDt);
        stat.records = validDetails;
        stat.totalCount = validDetails.reduce((sum, r) => sum + (r.howMany || 1), 0);
        const latest = [...validDetails].sort((a, b) => new Date(b.obsDt).getTime() - new Date(a.obsDt).getTime())[0];
        if (latest) {
          stat.latestTime = latest.obsDt;
          stat.latestCount = latest.howMany || 1;
        }
      } else {
        // Fallback to initial observation
        stat.records = [obs];
        stat.totalCount = (obs.howMany || 1);
        stat.latestTime = obs.obsDt;
        stat.latestCount = obs.howMany || 1;
      }
    });

    // Sort: Notable first, then Uncommon (<=3), then Common (>3). Then by totalCount ascending.
    return Array.from(statsMap.values()).sort((a, b) => {
      const getRarityRank = (s: any) => {
        if (s.isNotable) return 0; // Rare
        if (s.totalCount <= 3) return 1; // Uncommon
        return 2; // Common
      };
      const rankA = getRarityRank(a);
      const rankB = getRarityRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return a.totalCount - b.totalCount; // Ascending count
    });
  }, [observations, notableObservations, taxonomy, speciesDetailsCache]);

  // Get unique species from current observations
  const uniqueSpeciesCodes = Array.from(new Set(observations.map(o => o.speciesCode)));
  
  const totalRecordsCount = React.useMemo(() => {
    let count = 0;
    uniqueSpeciesCodes.forEach(code => {
      const details = speciesDetailsCache[code];
      count += details ? details.length : 1;
    });
    return count;
  }, [uniqueSpeciesCodes, speciesDetailsCache]);

  const filteredSpecies = uniqueSpeciesCodes.filter(code => {
    const name = taxonomy[code]?.comName || code;
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <>
      <button 
        className="md:hidden absolute top-4 left-4 z-40 p-2 bg-white rounded-md shadow-md text-slate-700"
        onClick={() => setIsMobileOpen(true)}
      >
        <Menu className="w-5 h-5" />
      </button>

      {isMobileOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 w-80 shrink-0 h-screen max-h-screen bg-white border-r border-slate-200 grid grid-rows-[auto_1fr] shadow-2xl z-50 transform transition-transform duration-300 ease-in-out overflow-hidden
        md:relative md:translate-x-0 md:shadow-lg md:z-10
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <MapIcon className="w-5 h-5 text-blue-600" />
            eBird 3D Explorer
          </h1>
          <button 
            className="md:hidden p-1 text-slate-500 hover:text-slate-800 rounded"
            onClick={() => setIsMobileOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

      <Tabs defaultValue="data" className="flex flex-col min-h-0 overflow-hidden">
        <TabsList className="w-full justify-start rounded-none border-b border-slate-200 px-4 bg-white h-12 shrink-0 overflow-x-auto hide-scrollbar">
          <TabsTrigger value="data" className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none whitespace-nowrap">按物种</TabsTrigger>
          <TabsTrigger value="locations" className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none whitespace-nowrap">按地点</TabsTrigger>
          <TabsTrigger value="filter" className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none whitespace-nowrap">过滤</TabsTrigger>
          <TabsTrigger value="settings" className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none whitespace-nowrap">设置</TabsTrigger>
        </TabsList>

        <TabsContent 
          value="data" 
          className="m-0 flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          {/* 折叠控制头 */}
          <div 
            className="flex items-center justify-between p-3 bg-white border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors shrink-0"
            onClick={() => setIsConfigExpanded(!isConfigExpanded)}
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-500" />
              <span className="font-medium text-sm text-slate-700">搜索参数与设置</span>
            </div>
            {isConfigExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </div>

          {/* 数据页签配置区 */}
          {isConfigExpanded && (
            <div className="p-4 space-y-4 border-b border-slate-100 bg-white shrink-0 overflow-y-auto max-h-[50vh]">
              <div className={`p-3 border rounded-lg text-sm ${searchMode === 'region' ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <p className="flex items-center gap-2 mb-1">
                  <Navigation className={`w-4 h-4 ${searchMode === 'region' ? 'text-blue-600' : ''}`} />
                  <strong>{searchMode === 'region' ? '区域查询模式' : '位置选择'}</strong>
                </p>
                <p>{searchMode === 'region' ? `当前区域：${regionName || regionCode}` : '在地图上长按（或右键点击）任意位置以设置搜索中心点。'}</p>
                <p className="mt-2 text-xs font-mono bg-white p-1 rounded border border-slate-100">
                  {searchMode === 'region' ? `区域代码: ${regionCode}` : `纬度: ${lat.toFixed(4)}, 经度: ${lng.toFixed(4)}`}
                </p>
                {searchMode === 'region' && (
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="h-auto p-0 text-[10px] text-blue-500 mt-2"
                    onClick={() => setSearchMode('radius')}
                  >
                    切换回半径查询模式
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">搜索半径 (公里)</Label>
                  <Input 
                    type="number" 
                    value={radius} 
                    onChange={e => setSearchParams({ radius: Number(e.target.value) })} 
                    disabled={searchMode === 'region'}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">过去几天</Label>
                  <Input type="number" value={daysBack} onChange={e => setSearchParams({ daysBack: Number(e.target.value) })} />
                </div>
              </div>
              <Button className="w-full" onClick={handleFetchData} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                获取观测数据
              </Button>

              <div className="pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <Label>地图显示模式</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">3D圆柱</span>
                    <Switch checked={isHeatmap} onCheckedChange={setIsHeatmap} />
                    <span className="text-xs text-slate-500">热力图</span>
                  </div>
                </div>
              </div>
              
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                <div className="flex justify-between items-center mb-1">
                  <p><strong>{totalRecordsCount}</strong> 条总观测记录</p>
                  {isBackgroundLoading && (
                    <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full animate-pulse font-medium">
                      同步中 {loadProgress.current}/{loadProgress.total}
                    </span>
                  )}
                </div>
                <p><strong>{uniqueSpeciesCodes.length}</strong> 种不同鸟类</p>
              </div>
            </div>
          )}

          <div className="overflow-y-auto bg-slate-50 p-2 space-y-1 flex-1 min-h-0">
            {speciesStats.map(stat => {
                const isSelected = selectedSpecies.includes(stat.code);
                const isExpanded = expandedSpecies.has(stat.code);
                
                let statusText = '常见';
                let statusColor = 'text-green-600 bg-green-100';
                if (stat.isNotable) {
                  statusText = '稀有';
                  statusColor = 'text-red-600 bg-red-100';
                } else if (stat.totalCount <= 3) {
                  statusText = '不常见';
                  statusColor = 'text-yellow-600 bg-yellow-100';
                }

                return (
                  <div key={stat.code} className="bg-white border border-slate-200 rounded overflow-hidden">
                    <div 
                      className="flex items-center p-2 hover:bg-slate-50 cursor-pointer"
                      onClick={() => toggleExpand(stat.code)}
                    >
                      <div className="flex items-center space-x-2 flex-1" onClick={e => e.stopPropagation()}>
                        <Checkbox 
                          id={`data-species-${stat.code}`} 
                          checked={isSelected}
                          onCheckedChange={() => toggleSpeciesSelection(stat.code)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{stat.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusColor}`}>
                              {statusText}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 flex justify-between">
                            <span>{stat.records.length} 条记录</span>
                            <span>最新: {new Date(stat.latestTime).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="ml-2 text-slate-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="bg-slate-50 p-2 border-t border-slate-100 text-xs space-y-2">
                        {stat.records.filter(r => r && r.obsDt).sort((a, b) => new Date(b.obsDt).getTime() - new Date(a.obsDt).getTime()).map((rec, i) => (
                          <div key={i} className="flex flex-col border-b border-slate-200 last:border-0 pb-1.5 pt-1 last:pb-0">
                            <div className="font-medium text-slate-700 truncate" title={rec.locName}>{rec.locName}</div>
                            <div className="flex items-center gap-2 text-[10px] mt-0.5 flex-wrap">
                              <span className="text-slate-500">{new Date(rec.obsDt).toLocaleString()}</span>
                              <span className="font-bold text-slate-700">{rec.howMany || 'X'} 只</span>
                              {rec.userDisplayName && (
                                <span className="text-slate-400 truncate">👤 {rec.userDisplayName}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {speciesStats.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">暂无数据</p>
              )}
          </div>
        </TabsContent>

        <TabsContent 
          value="locations" 
          className="m-0 flex-1 grid grid-rows-[1fr] min-h-0 overflow-hidden"
        >
          <div className="overflow-y-auto bg-slate-50 p-2 space-y-2 min-h-0">
            {(() => {
              const enrichedHotspots = getAggregatedData().map(hotspot => {
                const locRecords: any[] = [];
                const seenSubIds = new Set<string>();
                
                hotspot.observations.forEach(obs => {
                  const key = `${obs.subId}-${obs.speciesCode}`;
                  if (!seenSubIds.has(key)) {
                    seenSubIds.add(key);
                    locRecords.push(obs);
                  }
                });
                
                Object.values(speciesDetailsCache).forEach(detailsList => {
                  detailsList.forEach(obs => {
                    if (obs.locId === hotspot.locId) {
                      const key = `${obs.subId}-${obs.speciesCode}`;
                      if (!seenSubIds.has(key)) {
                        seenSubIds.add(key);
                        locRecords.push(obs);
                      }
                    }
                  });
                });
                
                const speciesGroups = new Map<string, any[]>();
                locRecords.forEach(rec => {
                  if (!speciesGroups.has(rec.speciesCode)) {
                    speciesGroups.set(rec.speciesCode, []);
                  }
                  speciesGroups.get(rec.speciesCode)!.push(rec);
                });
                
                const speciesArray = Array.from(speciesGroups.entries()).map(([code, records]) => {
                  const name = taxonomy[code]?.comName || code;
                  const isNotable = notableObservations.some(n => n.speciesCode === code);
                  const validRecords = records.filter(r => r && r.obsDt);
                  const sortedRecords = validRecords.sort((a, b) => new Date(b.obsDt).getTime() - new Date(a.obsDt).getTime());
                  const latestRecord = sortedRecords[0];
                  return { code, name, isNotable, records: sortedRecords, latestRecord };
                }).filter(sp => sp.latestRecord).sort((a, b) => b.records.length - a.records.length);

                return { ...hotspot, locRecords, speciesArray };
              }).sort((a, b) => b.locRecords.length - a.locRecords.length);

              if (enrichedHotspots.length === 0) {
                return <p className="text-sm text-slate-500 text-center py-4">暂无数据</p>;
              }

              return enrichedHotspots.map(hotspot => {
                const isExpanded = expandedLocations.has(hotspot.locId);
                return (
                  <div key={hotspot.locId} className="bg-white border border-slate-200 rounded overflow-hidden shadow-sm">
                    <div 
                      className="flex items-center p-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => toggleExpandLocation(hotspot.locId)}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="font-medium text-sm text-slate-800 truncate" title={hotspot.locName}>
                          {hotspot.locName}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 flex gap-3">
                          <span>{hotspot.speciesArray.length} 种鸟类</span>
                          <span>{hotspot.locRecords.length} 条观测记录</span>
                        </div>
                      </div>
                      <div className="text-slate-400 shrink-0">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100">
                        {hotspot.speciesArray.map(sp => (
                          <div key={sp.code} className="border-b border-slate-200 last:border-0 p-2">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2 min-w-0 pr-2">
                                <span className="font-medium text-sm text-slate-700 truncate">{sp.name}</span>
                                {sp.isNotable && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full text-red-600 bg-red-100 shrink-0">稀有</span>
                                )}
                              </div>
                              <div className="font-bold text-slate-700 whitespace-nowrap shrink-0">
                                {sp.latestRecord.howMany || 'X'} 只
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                              <span>{new Date(sp.latestRecord.obsDt).toLocaleString()}</span>
                              {sp.latestRecord.userDisplayName && (
                                <span className="truncate ml-2">👤 {sp.latestRecord.userDisplayName}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </TabsContent>

        <TabsContent 
          value="filter" 
          className="m-0 flex-1 grid grid-rows-[auto_1fr] min-h-0 overflow-hidden"
        >
          {/* 过滤页签配置区 */}
          <div className="p-4 border-b border-slate-200 space-y-3 bg-white overflow-y-auto">
            <Input 
              placeholder="搜索鸟种..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-9"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={selectAllSpecies}>全选</Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={deselectAllSpecies}>清空</Button>
            </div>
          </div>
          <div className="overflow-y-auto p-4 space-y-2 min-h-0">
            {filteredSpecies.map(code => {
                const name = taxonomy[code]?.comName || code;
                const isSelected = selectedSpecies.includes(code);
                
                const handleLocate = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  const obs = observations.find(o => o.speciesCode === code);
                  if (obs) {
                    flyTo(obs.lng, obs.lat);
                  }
                };

                return (
                  <div key={code} className="flex items-center justify-between group hover:bg-slate-50 p-1 -mx-1 rounded">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id={`species-${code}`} 
                        checked={isSelected}
                        onCheckedChange={() => toggleSpeciesSelection(code)}
                      />
                      <label 
                        htmlFor={`species-${code}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {name}
                      </label>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={handleLocate}
                      title="飞至该位置"
                    >
                      <Navigation className="h-3 w-3 text-blue-600" />
                    </Button>
                  </div>
                );
              })}
              {filteredSpecies.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">未找到相关鸟种。</p>
              )}
          </div>
        </TabsContent>

        <TabsContent 
          value="settings" 
          className="m-0 flex-1 min-h-0 overflow-y-auto p-4"
        >
          <div className="space-y-2">
              <Label>eBird API 密钥</Label>
              <Input 
                type="password" 
                value={apiKey} 
                onChange={e => setApiKey(e.target.value)} 
                placeholder="输入 eBird API 密钥"
              />
              <p className="text-xs text-slate-500">请在您的 eBird 账户设置中获取此密钥。</p>
            </div>

            <div className="space-y-2 pt-4 border-t border-slate-100">
              <Label>地图样式</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['dark', 'light', 'satellite'] as const).map((style) => (
                  <Button
                    key={style}
                    variant={mapStyle === style ? 'default' : 'outline'}
                    size="sm"
                    className="capitalize"
                    onClick={() => setMapStyle(style)}
                  >
                    {style === 'dark' ? '深色' : style === 'light' ? '浅色' : '卫星'}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>圆盘半径缩放</Label>
                  <span className="text-xs font-mono text-slate-500">{visualScale.toFixed(1)}x</span>
                </div>
                <Slider 
                  value={[visualScale]} 
                  min={0.5} 
                  max={3.0} 
                  step={0.1} 
                  onValueChange={(val) => {
                    if (Array.isArray(val)) setVisualScale(val[0]);
                    else setVisualScale(val as number);
                  }}
                />
                <p className="text-[10px] text-slate-400">调整 3D 圆柱体的底面半径大小</p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>堆叠高度缩放</Label>
                  <span className="text-xs font-mono text-slate-500">{heightScale.toFixed(1)}x</span>
                </div>
                <Slider 
                  value={[heightScale]} 
                  min={0.5} 
                  max={5.0} 
                  step={0.1} 
                  onValueChange={(val) => {
                    if (Array.isArray(val)) setHeightScale(val[0]);
                    else setHeightScale(val as number);
                  }}
                />
                <p className="text-[10px] text-slate-400">调整 3D 圆柱体圆盘之间的垂直间距</p>
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>显示半径遮罩</Label>
                  <p className="text-xs text-slate-500">在搜索半径外显示半透明遮罩</p>
                </div>
                <Switch 
                  checked={showRadiusMask}
                  onCheckedChange={setShowRadiusMask}
                />
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>中国地图偏移校正</Label>
                  <p className="text-xs text-slate-500">将点位向左上偏移，解决国内地图对齐问题</p>
                </div>
                <Switch 
                  checked={useChinaOffset}
                  onCheckedChange={setUseChinaOffset}
                />
              </div>
            </div>
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}
