import React, { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { GeminiConfig, CommunityPost, UserProfileData } from '../types';
import { auth } from '../firebaseConfig';

interface AdminConsoleProps {
  onBack: () => void;
}

const AdminConsole: React.FC<AdminConsoleProps> = ({ onBack }) => {
  // Credentials must be entered manually
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [config, setConfig] = useState<GeminiConfig | null>(null);
  const [status, setStatus] = useState('');
  
  // Navigation
  const [activeTab, setActiveTab] = useState<'activity' | 'ai_hub' | 'moderation'>('activity');
  
  // Moderation Data
  const [reportedPosts, setReportedPosts] = useState<CommunityPost[]>([]);
  
  // Activity / Log Tracking Data
  const [allUsers, setAllUsers] = useState<UserProfileData[]>([]);
  const [allPosts, setAllPosts] = useState<CommunityPost[]>([]);

  // Filters for AI Dataset Hub
  const [filterMediaType, setFilterMediaType] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const [filterHumanDelta, setFilterHumanDelta] = useState<'all' | 'verified' | 'raw'>('all');
  const [filterSearch, setFilterSearch] = useState('');
  const [selectedPostForInspection, setSelectedPostForInspection] = useState<CommunityPost | null>(null);

  // Automatic elevation check on mount
  useEffect(() => {
    const checkAdminAuth = async () => {
      const currentUser = auth.currentUser;
      if (currentUser && currentUser.email === 'ram@iitj.ac.in') {
        setIsAuthenticated(true);
        loadConfig();
        loadActivityLogs();
      }
    };
    checkAdminAuth();
  }, []);

  // Login Handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (email !== 'ram@iitj.ac.in') {
      setStatus('Access Denied: Only ram@iitj.ac.in has administrative privileges.');
      return;
    }
    
    try {
      await FirebaseService.loginUser(email, password);
      setIsAuthenticated(true);
      loadConfig();
      loadActivityLogs();
    } catch (err: any) {
      setStatus('Login failed: ' + err.message);
    }
  };

  const loadConfig = async () => {
    setStatus('Loading configuration...');
    const data = await FirebaseService.getGeminiConfig();
    setConfig(data);
    setStatus('');
  };

  const loadActivityLogs = async () => {
    setStatus('Syncing live data...');
    try {
      const users = await FirebaseService.getAllUsers();
      const posts = await FirebaseService.getAllPosts();
      setAllUsers(users);
      setAllPosts(posts);
      if (posts.length > 0 && !selectedPostForInspection) {
        setSelectedPostForInspection(posts[0]);
      }
      setStatus('');
    } catch (e: any) {
      setStatus('Failed syncing log indices: ' + e.message);
    }
  };

  const loadReportedPosts = async () => {
      setStatus('Fetching reports...');
      const posts = await FirebaseService.getReportedPosts();
      setReportedPosts(posts);
      setStatus(`Found ${posts.length} reported items.`);
  };

  useEffect(() => {
      if (isAuthenticated) {
          if (activeTab === 'moderation') {
              loadReportedPosts();
          } else {
              loadActivityLogs();
          }
      }
  }, [isAuthenticated, activeTab]);

  const handleDismissReport = async (postId: string) => {
      await FirebaseService.dismissReports(postId);
      setReportedPosts(prev => prev.filter(p => p.id !== postId));
      setStatus('Report dismissed. Content kept.');
  };

  const handleDeleteContent = async (postId: string) => {
      if(window.confirm("Are you sure you want to permanently delete this content?")) {
          try {
              setReportedPosts(prev => prev.filter(p => p.id !== postId));
              setAllPosts(prev => prev.filter(p => p.id !== postId));
              await FirebaseService.deletePost(postId);
              setStatus('Content deleted from ecosystem.');
          } catch (e) {
              setStatus('Failed to delete content.');
              loadReportedPosts();
          }
      }
  };

  const handleSignOut = () => {
    FirebaseService.logout();
    onBack();
  };

  // Filtering function for AI Dataset
  const getFilteredPosts = () => {
    return allPosts.filter(post => {
      if (filterMediaType !== 'all' && post.mediaType !== filterMediaType) return false;
      if (filterHumanDelta === 'verified' && !post.humanDelta) return false;
      if (filterHumanDelta === 'raw' && post.humanDelta) return false;
      if (filterSearch.trim() !== '') {
        const query = filterSearch.toLowerCase();
        const labelsStr = (post.labels || []).join(' ').toLowerCase();
        const behaviorStr = (post.behavior || '').toLowerCase();
        const locStr = (post.locationArea || '').toLowerCase();
        const userStr = (post.userName || '').toLowerCase();
        if (!labelsStr.includes(query) && !behaviorStr.includes(query) && !locStr.includes(query) && !userStr.includes(query)) {
          return false;
        }
      }
      return true;
    });
  };

  // EXPORT 1: CSV Metadata
  const downloadMetadataCSV = () => {
      const postsToExport = getFilteredPosts();
      if (postsToExport.length === 0) {
          setStatus('No data available to export.');
          return;
      }
      
      const headers = [
          'Post ID', 'User ID', 'User Name', 'Media Type', 'Species Taxonomy', 'Ethological Behavior', 
          'Timestamp UTC', 'Location Area', 'Raw Latitude', 'Raw Longitude', 'Recording Duration (ms)', 
          'Session Retakes', 'AI Proposed Labels', 'AI Proposed Behavior', 'Human In Loop Delta', 
          'Bioacoustic Vocalization Type', 'Bioacoustic Freq Range', 'Visual Motion Posture', 'Micro Habitat',
          'Likes Count', 'Comments Count', 'Report Count'
      ];
      
      const rows = postsToExport.map(post => {
          const ts = post.timestamp?.toMillis ? post.timestamp.toMillis() : (post.timestamp?.seconds ? post.timestamp.seconds * 1000 : post.timestamp);
          const dateStr = ts ? new Date(ts).toISOString() : '';
          const eth = post.ethologicalDescriptors;
          return [
              post.id,
              post.userId,
              `"${(post.userName || '').replace(/"/g, '""')}"`,
              post.mediaType,
              `"${(post.labels?.join('; ') || '').replace(/"/g, '""')}"`,
              `"${(post.behavior || '').replace(/"/g, '""')}"`,
              dateStr,
              `"${(post.locationArea || '').replace(/"/g, '""')}"`,
              post.rawLocation?.lat || '',
              post.rawLocation?.lng || '',
              post.timeToRecordMs || '',
              post.sessionRetakes || '',
              `"${(post.aiProposedLabels?.join('; ') || '').replace(/"/g, '""')}"`,
              `"${(post.aiProposedBehavior || '').replace(/"/g, '""')}"`,
              post.humanDelta ? 'true' : 'false',
              `"${(eth?.bioacousticProfile?.vocalizationType || '').replace(/"/g, '""')}"`,
              `"${(eth?.bioacousticProfile?.frequencyRangeHz || '').replace(/"/g, '""')}"`,
              `"${(eth?.visualEthology?.motionPosture || '').replace(/"/g, '""')}"`,
              `"${(eth?.habitatNiche?.microHabitat || '').replace(/"/g, '""')}"`,
              post.likes?.length || 0,
              post.commentCount || 0,
              post.reportCount || 0
          ].join(',');
      });
      
      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `naturegram_ethology_dataset_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setStatus(`Exported ${postsToExport.length} records to CSV.`);
  };

  // EXPORT 2: JSONL for Gemini / DeepMind Fine-Tuning
  const downloadJSONLDataset = () => {
      const postsToExport = getFilteredPosts();
      if (postsToExport.length === 0) {
          setStatus('No data available to export.');
          return;
      }

      const jsonlLines = postsToExport.map(post => {
          const ts = post.timestamp?.toMillis ? post.timestamp.toMillis() : (post.timestamp?.seconds ? post.timestamp.seconds * 1000 : post.timestamp);
          const dateStr = ts ? new Date(ts).toISOString() : '';
          
          const record = {
              specimen_id: post.id,
              media_type: post.mediaType,
              media_url: post.imageUrl || post.videoUrl || post.audioUrl || post.thumbnailUrl,
              taxonomy: post.labels || [],
              ethological_behavior: post.behavior || "",
              ai_insight: post.aiInsight || "",
              spatial_temporal: {
                  location_area: post.locationArea || "",
                  latitude: post.rawLocation?.lat || null,
                  longitude: post.rawLocation?.lng || null,
                  timestamp_utc: dateStr
              },
              human_in_loop: {
                  human_verified_delta: !!post.humanDelta,
                  ai_proposed_taxonomy: post.aiProposedLabels || [],
                  ai_proposed_behavior: post.aiProposedBehavior || ""
              },
              telemetry: {
                  time_to_record_ms: post.timeToRecordMs || 0,
                  session_retakes: post.sessionRetakes || 0
              }
          };

          return JSON.stringify({
              messages: [
                  {
                      role: "user",
                      content: [
                          { type: "text", text: `Identify the species, taxonomy, and observed ethological behaviors for this nature specimen recorded in ${post.locationArea || 'field'}.` },
                          { type: "image_url", image_url: { url: record.media_url } }
                      ]
                  },
                  {
                      role: "assistant",
                      content: JSON.stringify({
                          species: record.taxonomy,
                          behavior: record.ethological_behavior,
                          ai_analysis: record.ai_insight
                      })
                  }
              ],
              raw_specimen_metadata: record
          });
      });

      const blob = new Blob([jsonlLines.join('\n')], { type: 'application/x-jsonlines' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `naturegram_deepmind_tuning_${new Date().toISOString().split('T')[0]}.jsonl`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatus(`Exported ${postsToExport.length} JSONL multimodal training records.`);
  };

  // EXPORT 3: COCO Ethology Format JSON
  const downloadCOCODataset = () => {
      const postsToExport = getFilteredPosts();
      if (postsToExport.length === 0) {
          setStatus('No data available to export.');
          return;
      }

      const categoriesMap = new Map<string, number>();
      let catIdCounter = 1;

      postsToExport.forEach(p => {
          (p.labels || []).forEach(lbl => {
              if (!categoriesMap.has(lbl)) {
                  categoriesMap.set(lbl, catIdCounter++);
              }
          });
      });

      const images = postsToExport.map((p, idx) => ({
          id: idx + 1,
          file_name: p.imageUrl || p.thumbnailUrl || p.id,
          coco_url: p.imageUrl || p.thumbnailUrl || "",
          height: 1080,
          width: 1080,
          date_captured: p.timestamp?.seconds ? new Date(p.timestamp.seconds * 1000).toISOString() : "",
          location: p.locationArea || "",
          geo_lat: p.rawLocation?.lat || null,
          geo_lng: p.rawLocation?.lng || null
      }));

      const annotations: any[] = [];
      let annId = 1;

      postsToExport.forEach((p, idx) => {
          (p.labels || []).forEach(lbl => {
              annotations.push({
                  id: annId++,
                  image_id: idx + 1,
                  category_id: categoriesMap.get(lbl) || 1,
                  behavior_description: p.behavior || "",
                  human_verified: !!p.humanDelta,
                  iscrowd: 0
              });
          });
      });

      const categories = Array.from(categoriesMap.entries()).map(([name, id]) => ({
          id,
          name,
          supercategory: "Organism"
      }));

      const cocoData = {
          info: {
              description: "NatureGram Open Bioacoustics and Ethology COCO Dataset",
              url: "https://naturegram.app",
              version: "1.0",
              year: new Date().getFullYear(),
              contributor: "NatureGram Citizen Science Community",
              date_created: new Date().toISOString()
          },
          licenses: [{ id: 1, name: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/" }],
          images,
          annotations,
          categories
      };

      const blob = new Blob([JSON.stringify(cocoData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `naturegram_coco_ethology_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatus(`Exported COCO dataset with ${images.length} images & ${annotations.length} behavioral annotations.`);
  };

  const downloadUsersCSV = () => {
      if (allUsers.length === 0) {
          setStatus('No user data available.');
          return;
      }
      
      const headers = ['User ID', 'Username', 'Email', 'Joined At', 'Location', 'Is Anonymous'];
      
      const rows = allUsers.map(user => {
          const ts = user.joinedAt?.toMillis ? user.joinedAt.toMillis() : (user.joinedAt?.seconds ? user.joinedAt.seconds * 1000 : user.joinedAt);
          const dateStr = ts ? new Date(ts).toISOString() : '';
          return [
              user.uid,
              `"${(user.username || '').replace(/"/g, '""')}"`,
              user.email || '',
              dateStr,
              `"${(user.location || '').replace(/"/g, '""')}"`,
              user.isAnonymous ? 'true' : 'false'
          ].join(',');
      });
      
      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `naturegram_users_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const filteredPosts = getFilteredPosts();

  // Metrics calculation
  const totalPosts = allPosts.length;
  const postsWithHumanDelta = allPosts.filter(p => p.humanDelta).length;
  const agreementRate = totalPosts > 0 ? (((totalPosts - postsWithHumanDelta) / totalPosts) * 100).toFixed(1) : '100.0';
  const audioCount = allPosts.filter(p => p.mediaType === 'audio').length;
  const imageCount = allPosts.filter(p => p.mediaType === 'image' || !p.mediaType).length;
  const videoCount = allPosts.filter(p => p.mediaType === 'video').length;
  const uniqueLocations = new Set(allPosts.map(p => p.locationArea).filter(Boolean)).size;

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-theme-primary p-6">
        <div className="w-full max-w-md glass-panel p-8 rounded-2xl bg-white/5 border border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <span className="material-symbols-outlined text-primary text-3xl">admin_panel_settings</span>
            <h1 className="text-2xl font-bold text-white">Admin Console</h1>
          </div>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input 
              type="email" 
              placeholder="Admin Email" 
              className="bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-primary outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input 
              type="password" 
              placeholder="Password" 
              className="bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-primary outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" className="bg-primary text-black font-bold p-3 rounded-lg hover:bg-primary/90 transition-colors">
              Access Control
            </button>
            {status && <p className="text-red-400 text-sm mt-2">{status}</p>}
          </form>
          <button onClick={onBack} className="mt-6 text-white/40 text-sm hover:text-white">← Back to App</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-day-bg overflow-hidden font-body animate-fade-in relative z-50">
      {/* Header */}
      <header className="flex items-center justify-between p-6 border-b border-theme-primary/10 bg-white shadow-sm shrink-0">
        <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-theme-accent">psychology</span>
            <div>
              <h1 className="text-xl font-bold font-display italic tracking-tight text-theme-primary">Admin & Research Console</h1>
              <p className="text-[10px] text-theme-primary/50 font-mono">DeepMind Multimodal Data & Ethology Hub</p>
            </div>
        </div>
        <div className="flex items-center gap-4">
            <span className="text-theme-primary/60 text-xs font-bold uppercase tracking-wider">{status}</span>
            <button onClick={onBack} className="bg-theme-primary/5 hover:bg-theme-primary/10 text-theme-primary px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all">
                Exit Console
            </button>
            <button onClick={handleSignOut} className="text-theme-primary/40 hover:text-red-500 font-bold text-[10px] uppercase tracking-widest transition-colors">
                Sign Out
            </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r border-theme-primary/10 bg-black/[0.02] p-4 shrink-0 flex flex-col justify-between">
            <div>
              <h3 className="text-theme-primary/40 text-xs font-bold uppercase tracking-wider mb-4">Modules</h3>
              <div className="flex flex-col gap-2">
                  <button 
                      onClick={() => setActiveTab('activity')}
                      className={`text-left px-4 py-3 rounded-lg flex items-center gap-3 font-semibold text-xs transition-all ${activeTab === 'activity' ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30 font-bold' : 'text-stone-600 hover:bg-white/60'}`}
                  >
                      <span className="material-symbols-outlined text-sm">analytics</span>
                      Platform Analytics
                  </button>

                  <button 
                      onClick={() => setActiveTab('ai_hub')}
                      className={`text-left px-4 py-3 rounded-lg flex items-center gap-3 font-semibold text-xs transition-all ${activeTab === 'ai_hub' ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30 font-bold' : 'text-stone-600 hover:bg-white/60'}`}
                  >
                      <span className="material-symbols-outlined text-sm">hub</span>
                      AI Dataset & Research Hub
                      <span className="ml-auto bg-amber-500/20 text-amber-700 font-bold text-[9px] px-1.5 py-0.5 rounded">DeepMind</span>
                  </button>

                  <button 
                      onClick={() => setActiveTab('moderation')}
                      className={`text-left px-4 py-3 rounded-lg flex items-center gap-3 font-semibold text-xs transition-all ${activeTab === 'moderation' ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30 font-bold' : 'text-stone-600 hover:bg-white/60'}`}
                  >
                      <span className="material-symbols-outlined text-sm">gavel</span>
                      Moderation Queue
                      {reportedPosts.length > 0 && <span className="ml-auto bg-red-500 text-white text-[10px] px-1.5 rounded-full">{reportedPosts.length}</span>}
                  </button>
              </div>
            </div>

            <div className="p-4 bg-white/80 border border-theme-primary/10 rounded-2xl text-[10px] text-theme-primary/60 space-y-1">
              <p className="font-bold text-theme-primary">NatureGram Open Science</p>
              <p>Capturing high-fidelity bioacoustic, visual, and behavioral ethograms for foundation nature models.</p>
            </div>
        </aside>

        {/* Editor Area */}
        <main className="flex-1 p-8 overflow-y-auto">
            
            {/* ACTIVITY LOGS TAB */}
            {activeTab === 'activity' && (
                <div className="max-w-6xl mx-auto flex flex-col gap-8">
                    <div className="flex justify-between items-center bg-white shadow-sm border border-theme-primary/10 rounded-2xl p-6">
                        <div>
                            <h2 className="text-theme-primary text-2xl font-black tracking-tight flex items-center gap-2 font-display italic">
                                <span className="material-symbols-outlined text-theme-accent">monitoring</span>
                                Platform Activity Analytics
                            </h2>
                            <p className="text-theme-primary/50 text-xs mt-1">Live tracking of active explorers, encounters and client contributions</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={downloadMetadataCSV}
                                className="bg-theme-accent/5 hover:bg-theme-accent/10 border border-theme-accent/20 text-theme-accent rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs font-black uppercase tracking-widest transition-all"
                            >
                                <span className="material-symbols-outlined text-sm">download</span>
                                Export CSV
                            </button>
                            <button 
                                onClick={loadActivityLogs}
                                className="bg-theme-primary/5 hover:bg-theme-primary/10 border border-theme-primary/10 text-theme-primary rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs font-black uppercase tracking-widest transition-all"
                            >
                                <span className="material-symbols-outlined text-sm">sync</span>
                                Refresh Logs
                            </button>
                        </div>
                    </div>

                    {/* METRICS STACK */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div className="bg-white border border-theme-primary/10 p-6 rounded-[2rem] shadow-sm flex items-center gap-5">
                            <div className="w-12 h-12 rounded-2xl bg-theme-accent/10 flex items-center justify-center text-theme-accent shrink-0">
                                <span className="material-symbols-outlined text-2xl">group</span>
                            </div>
                            <div>
                                <p className="text-theme-primary/40 text-[9px] font-black uppercase tracking-widest">Total Explorers</p>
                                <p className="text-2xl font-black text-theme-primary">{allUsers.length}</p>
                            </div>
                        </div>

                        <div className="bg-white border border-theme-primary/10 p-6 rounded-[2rem] shadow-sm flex items-center gap-5">
                            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-600 shrink-0">
                                <span className="material-symbols-outlined text-2xl">explore</span>
                            </div>
                            <div>
                                <p className="text-theme-primary/40 text-[9px] font-black uppercase tracking-widest">Sightings Recorded</p>
                                <p className="text-2xl font-black text-theme-primary">{allPosts.length}</p>
                            </div>
                        </div>

                        <div className="bg-white border border-theme-primary/10 p-6 rounded-[2rem] shadow-sm flex items-center gap-5">
                            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-500 shrink-0">
                                <span className="material-symbols-outlined text-2xl">forum</span>
                            </div>
                            <div>
                                <p className="text-theme-primary/40 text-[9px] font-black uppercase tracking-widest">Social Interactions</p>
                                <p className="text-2xl font-black text-theme-primary">
                                    {allPosts.reduce((sum, p) => sum + (p.likes?.length || 0) + (p.commentCount || 0), 0)}
                                </p>
                            </div>
                        </div>

                        <div className="bg-white border border-theme-primary/10 p-6 rounded-[2rem] shadow-sm flex items-center gap-5">
                            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0">
                                <span className="material-symbols-outlined text-2xl">psychology</span>
                            </div>
                            <div>
                                <p className="text-theme-primary/40 text-[9px] font-black uppercase tracking-widest">Species Wealth</p>
                                <p className="text-2xl font-black text-theme-primary">
                                    {new Set(allPosts.flatMap(p => p.labels || [])).size}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* TWO-COLUMN LAYOUT: USERS AND POSTS ACTVITY */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        {/* Users access list */}
                        <div className="lg:col-span-4 bg-white border border-theme-primary/10 rounded-3xl p-6 flex flex-col h-[500px] shadow-sm">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-theme-primary font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
                                    <span className="material-symbols-outlined text-xs text-theme-primary/50">people</span>
                                    Registered Explorers ({allUsers.length})
                                </h3>
                                <button
                                    onClick={downloadUsersCSV}
                                    className="bg-theme-accent/5 hover:bg-theme-accent/10 text-theme-accent p-1.5 rounded-lg transition-colors border border-theme-accent/20"
                                    title="Export Users CSV"
                                >
                                    <span className="material-symbols-outlined text-xs">download</span>
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-3 pr-2 no-scrollbar">
                                {allUsers.map((user, idx) => (
                                    <div key={user.uid || idx} className="bg-stone-50 border border-theme-primary/10 rounded-2xl p-4 flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center text-theme-primary font-black shrink-0 text-sm uppercase overflow-hidden">
                                            {user.avatarUrl ? (
                                                <img src={user.avatarUrl} className="w-full h-full object-cover" />
                                            ) : (
                                                user.username?.slice(0, 2) || "EX"
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-stone-800 font-bold text-xs flex items-center gap-2">
                                                {user.username || 'Anonymous'}
                                                {user.isAnonymous && <span className="bg-theme-accent/20 text-theme-accent px-1.5 py-0.5 rounded text-[8px] uppercase font-black">Anonymous</span>}
                                            </p>
                                            <p className="text-theme-primary/50 text-[9px] truncate mt-0.5">Joined {user.joinedAt?.toDate ? new Date(user.joinedAt.toDate()).toLocaleDateString() : 'Just Now'} • {user.location || 'Unknown Location'}</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="bg-white/5 border border-white/10 text-white/70 px-2 py-1 rounded text-[8px] font-bold">
                                                {user.stats?.observations || 0} Obs
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Recent Activity Thread list */}
                        <div className="lg:col-span-8 bg-white border border-theme-primary/10 rounded-3xl p-6 flex flex-col h-[500px] shadow-sm">
                            <h3 className="text-theme-primary font-black text-[10px] uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs text-theme-primary/50">history</span>
                                Incident & Observation Thread ({allPosts.length})
                            </h3>
                            <div className="flex-1 overflow-y-auto space-y-4 pr-1 no-scrollbar flex flex-col">
                                {allPosts.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-theme-primary/30 italic text-sm font-display tracking-wide">
                                        No observations captured on the field yet.
                                    </div>
                                ) : (
                                    allPosts.map((post, idx) => (
                                        <div key={post.id || idx} className="bg-stone-50 border border-theme-primary/10 rounded-2xl p-5 flex gap-4 transition-all hover:bg-stone-100">
                                            {/* Media Thumbnail Indicator */}
                                            <div className="w-16 h-16 shrink-0 rounded-xl bg-stone-200 border border-theme-primary/5 overflow-hidden relative flex items-center justify-center">
                                                {post.mediaType === 'audio' ? (
                                                    <div className="w-full h-full flex items-center justify-center bg-stone-800 text-amber-500">
                                                        <span className="material-symbols-outlined text-xl">audiotrack</span>
                                                    </div>
                                                ) : (
                                                    <img src={post.thumbnailUrl || post.imageUrl} className="w-full h-full object-cover" />
                                                )}
                                            </div>
                                            
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-theme-primary font-bold text-xs truncate">{post.userName || 'Unknown Explorer'}</span>
                                                    <span className="text-theme-primary/30 text-[9px]">
                                                        {post.timestamp?.toDate ? new Date(post.timestamp.toDate()).toLocaleDateString() : 'Active'}
                                                    </span>
                                                </div>
                                                
                                                <div className="flex gap-1.5 flex-wrap my-1.5">
                                                    {(post.labels || []).slice(0, 3).map((lbl, i) => (
                                                        <span key={i} className="bg-theme-accent/10 border border-theme-accent/20 text-theme-primary rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest">
                                                            {lbl}
                                                        </span>
                                                    ))}
                                                    {post.locationArea && (
                                                        <span className="bg-blue-500/10 border border-blue-500/20 text-blue-600 rounded px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-black">
                                                            {post.locationArea}
                                                        </span>
                                                    )}
                                                </div>

                                                <p className="text-theme-primary/70 text-xs italic line-clamp-2 mt-2">
                                                    "{post.behavior || post.aiInsight || 'No description provided.'}"
                                                </p>

                                                <div className="mt-3 flex gap-4 items-center text-theme-primary/30 text-[10px] font-bold">
                                                    <span className="flex items-center gap-1">
                                                        <span className="material-symbols-outlined text-xs">thumb_up</span>
                                                        {post.likes?.length || 0} Likes
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <span className="material-symbols-outlined text-xs">comment</span>
                                                        {post.commentCount || 0} Comments
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* AI DATASET & RESEARCH HUB TAB */}
            {activeTab === 'ai_hub' && (
                <div className="max-w-6xl mx-auto flex flex-col gap-8">
                    {/* Header Banner */}
                    <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white rounded-3xl p-8 shadow-md border border-stone-700 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                        <div>
                            <div className="inline-flex items-center gap-2 bg-amber-500/20 border border-amber-500/30 text-amber-300 px-3 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest mb-3">
                                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                                DeepMind & AI Research Engine
                            </div>
                            <h2 className="text-3xl font-bold font-display italic tracking-tight">Ethology & Biodiversity AI Dataset Exporter</h2>
                            <p className="text-stone-300 text-xs mt-2 max-w-2xl leading-relaxed">
                                Formatted multimodal export pipeline for training foundation nature models (e.g. Gemini, DeepMind Bioacoustics, Computer Vision). Includes species taxonomy, behavioral ethograms, human-in-the-loop correction deltas, and spatial-temporal telemetry.
                            </p>
                        </div>

                        {/* Export Action Buttons */}
                        <div className="flex flex-wrap gap-3 shrink-0">
                            <button 
                                onClick={downloadJSONLDataset}
                                className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-black px-4 py-3 rounded-xl flex items-center gap-2 text-xs uppercase tracking-wider transition-all shadow-lg"
                                title="Download JSONL dataset for Gemini / DeepMind fine-tuning"
                            >
                                <span className="material-symbols-outlined text-sm">terminal</span>
                                Export JSONL
                            </button>
                            <button 
                                onClick={downloadCOCODataset}
                                className="bg-stone-700 hover:bg-stone-600 border border-stone-500 text-white font-bold px-4 py-3 rounded-xl flex items-center gap-2 text-xs uppercase tracking-wider transition-all"
                                title="Download COCO-format JSON for Computer Vision models"
                            >
                                <span className="material-symbols-outlined text-sm">dataset</span>
                                COCO Format
                            </button>
                            <button 
                                onClick={downloadMetadataCSV}
                                className="bg-stone-800 hover:bg-stone-700 border border-stone-600 text-stone-200 font-bold px-4 py-3 rounded-xl flex items-center gap-2 text-xs uppercase tracking-wider transition-all"
                                title="Download CSV matrix"
                            >
                                <span className="material-symbols-outlined text-sm">file_download</span>
                                Full CSV
                            </button>
                        </div>
                    </div>

                    {/* AI DATASET METRICS & GROUNDING ACCURACY */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                        <div className="bg-white border border-stone-200 p-5 rounded-2xl shadow-sm">
                            <p className="text-stone-400 text-[10px] font-bold uppercase tracking-widest">Dataset Size</p>
                            <p className="text-2xl font-black text-stone-900 mt-1">{totalPosts} <span className="text-xs font-normal text-stone-500">specimens</span></p>
                            <p className="text-[10px] text-stone-500 mt-1">{filteredPosts.length} selected by filter</p>
                        </div>

                        <div className="bg-white border border-stone-200 p-5 rounded-2xl shadow-sm">
                            <p className="text-stone-400 text-[10px] font-bold uppercase tracking-widest">AI Grounding Agreement</p>
                            <p className="text-2xl font-black text-emerald-600 mt-1">{agreementRate}%</p>
                            <p className="text-[10px] text-stone-500 mt-1">{postsWithHumanDelta} modified by human</p>
                        </div>

                        <div className="bg-white border border-stone-200 p-5 rounded-2xl shadow-sm">
                            <p className="text-stone-400 text-[10px] font-bold uppercase tracking-widest">Bioacoustic Audio</p>
                            <p className="text-2xl font-black text-amber-600 mt-1">{audioCount} <span className="text-xs font-normal text-stone-500">samples</span></p>
                            <p className="text-[10px] text-stone-500 mt-1">Birdsong & soundscapes</p>
                        </div>

                        <div className="bg-white border border-stone-200 p-5 rounded-2xl shadow-sm">
                            <p className="text-stone-400 text-[10px] font-bold uppercase tracking-widest">Visual Specimens</p>
                            <p className="text-2xl font-black text-blue-600 mt-1">{imageCount + videoCount} <span className="text-xs font-normal text-stone-500">files</span></p>
                            <p className="text-[10px] text-stone-500 mt-1">{imageCount} photos • {videoCount} videos</p>
                        </div>

                        <div className="bg-white border border-stone-200 p-5 rounded-2xl shadow-sm">
                            <p className="text-stone-400 text-[10px] font-bold uppercase tracking-widest">Spatial Coverage</p>
                            <p className="text-2xl font-black text-purple-600 mt-1">{uniqueLocations}</p>
                            <p className="text-[10px] text-stone-500 mt-1">Distinct habitats & coordinates</p>
                        </div>
                    </div>

                    {/* FILTER MATRIX CONTROL BAR */}
                    <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
                        <div className="flex items-center gap-3 w-full md:w-auto">
                            <span className="material-symbols-outlined text-stone-400 text-sm">filter_alt</span>
                            <span className="text-xs font-bold text-stone-700 uppercase tracking-wider">Dataset Filter Matrix:</span>
                        </div>

                        <div className="flex flex-wrap gap-3 w-full md:w-auto items-center">
                            {/* Media Type Filter */}
                            <select 
                                value={filterMediaType}
                                onChange={(e) => setFilterMediaType(e.target.value as any)}
                                className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-semibold text-stone-700 outline-none focus:border-amber-500"
                            >
                                <option value="all">All Media Types</option>
                                <option value="image">Image Specimens</option>
                                <option value="audio">Bioacoustic Audio</option>
                                <option value="video">Motion Video</option>
                            </select>

                            {/* Human Correction Delta Filter */}
                            <select 
                                value={filterHumanDelta}
                                onChange={(e) => setFilterHumanDelta(e.target.value as any)}
                                className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs font-semibold text-stone-700 outline-none focus:border-amber-500"
                            >
                                <option value="all">All Observations</option>
                                <option value="verified">Human-Verified / Edited (High Precision)</option>
                                <option value="raw">Raw AI Proposals</option>
                            </select>

                            {/* Search filter */}
                            <div className="relative flex-1 md:w-64">
                                <input 
                                    type="text" 
                                    placeholder="Search taxonomy or behavior..."
                                    value={filterSearch}
                                    onChange={(e) => setFilterSearch(e.target.value)}
                                    className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-8 pr-3 py-2 text-xs text-stone-800 outline-none focus:border-amber-500"
                                />
                                <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-stone-400 text-xs">search</span>
                            </div>
                        </div>
                    </div>

                    {/* TWO-COLUMN WORKBENCH: SPECIMEN LIST & FINE-TUNING INSPECTOR */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        {/* Specimen List */}
                        <div className="lg:col-span-6 bg-white border border-stone-200 rounded-3xl p-6 flex flex-col h-[550px] shadow-sm">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-stone-800 font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                                    <span className="material-symbols-outlined text-amber-600 text-sm">microscope</span>
                                    Filtered Specimens ({filteredPosts.length})
                                </h3>
                                <span className="text-[10px] text-stone-400 font-mono">Click to inspect payload</span>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-3 pr-2 no-scrollbar">
                                {filteredPosts.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-stone-400 italic text-xs">
                                        No specimens match current dataset filters.
                                    </div>
                                ) : (
                                    filteredPosts.map((post) => {
                                        const isSelected = selectedPostForInspection?.id === post.id;
                                        return (
                                            <div 
                                                key={post.id}
                                                onClick={() => setSelectedPostForInspection(post)}
                                                className={`p-4 rounded-2xl border transition-all cursor-pointer flex gap-4 items-center ${
                                                    isSelected 
                                                        ? 'bg-amber-50/80 border-amber-400 shadow-sm' 
                                                        : 'bg-stone-50 border-stone-200 hover:bg-stone-100'
                                                }`}
                                            >
                                                <div className="w-12 h-12 rounded-xl bg-stone-200 shrink-0 overflow-hidden flex items-center justify-center relative">
                                                    {post.mediaType === 'audio' ? (
                                                        <span className="material-symbols-outlined text-amber-600 text-xl">audiotrack</span>
                                                    ) : (
                                                        <img src={post.thumbnailUrl || post.imageUrl} className="w-full h-full object-cover" />
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-xs font-bold text-stone-900 truncate">
                                                            {(post.labels || ['Unknown'])[0]}
                                                        </p>
                                                        {post.humanDelta && (
                                                            <span className="bg-emerald-100 text-emerald-800 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">
                                                                Human Corrected
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] text-stone-500 italic truncate mt-0.5">
                                                        "{post.behavior || post.aiInsight || 'No behavior recorded'}"
                                                    </p>
                                                    <div className="flex items-center gap-2 text-[9px] text-stone-400 mt-1">
                                                        <span>{post.mediaType || 'image'}</span>
                                                        <span>•</span>
                                                        <span>{post.locationArea || 'Field'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* JSON Payload Inspector */}
                        <div className="lg:col-span-6 bg-stone-900 border border-stone-800 text-stone-200 rounded-3xl p-6 flex flex-col h-[550px] shadow-lg">
                            <div className="flex justify-between items-center mb-4 pb-3 border-b border-stone-800">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-amber-400 text-sm">code</span>
                                    <h3 className="text-amber-400 font-mono text-xs font-bold uppercase tracking-wider">
                                        Multimodal Training Payload Preview
                                    </h3>
                                </div>
                                {selectedPostForInspection && (
                                    <button 
                                        onClick={() => {
                                            navigator.clipboard.writeText(JSON.stringify(selectedPostForInspection, null, 2));
                                            setStatus('JSON snippet copied to clipboard.');
                                        }}
                                        className="bg-stone-800 hover:bg-stone-700 text-stone-300 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 transition-colors border border-stone-700"
                                    >
                                        <span className="material-symbols-outlined text-xs">content_copy</span>
                                        Copy JSON
                                    </button>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto no-scrollbar font-mono text-[11px] leading-relaxed text-amber-200/90 bg-stone-950 p-4 rounded-2xl border border-stone-800">
                                {selectedPostForInspection ? (
                                    <pre className="whitespace-pre-wrap break-all">
                                        {JSON.stringify({
                                            specimen_id: selectedPostForInspection.id,
                                            user_author: selectedPostForInspection.userName,
                                            media_type: selectedPostForInspection.mediaType || 'image',
                                            taxonomy_labels: selectedPostForInspection.labels,
                                            behavioral_ethogram: selectedPostForInspection.behavior,
                                            ai_multimodal_insight: selectedPostForInspection.aiInsight,
                                            ethological_descriptors: selectedPostForInspection.ethologicalDescriptors || null,
                                            spatial_temporal: {
                                                location: selectedPostForInspection.locationArea,
                                                latitude: selectedPostForInspection.rawLocation?.lat,
                                                longitude: selectedPostForInspection.rawLocation?.lng,
                                                timestamp: selectedPostForInspection.timestamp
                                            },
                                            human_in_loop_validation: {
                                                human_edited_delta: !!selectedPostForInspection.humanDelta,
                                                ai_proposed_labels: selectedPostForInspection.aiProposedLabels,
                                                ai_proposed_behavior: selectedPostForInspection.aiProposedBehavior
                                            },
                                            session_telemetry: {
                                                time_to_record_ms: selectedPostForInspection.timeToRecordMs,
                                                retakes: selectedPostForInspection.sessionRetakes
                                            }
                                        }, null, 2)}
                                    </pre>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-stone-600 italic">
                                        Select a specimen from the left list to inspect its JSON schema.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODERATION TAB */}
            {activeTab === 'moderation' && (
                <div className="max-w-5xl mx-auto">
                    <h2 className="text-theme-primary text-2xl font-bold mb-6 font-display">Reported Content Queue</h2>
                    
                    {reportedPosts.length === 0 ? (
                        <div className="text-center py-20 text-theme-primary/50 italic">
                            No reported content. The ecosystem is healthy.
                        </div>
                    ) : (
                        <div className="grid gap-6">
                            {reportedPosts.map(post => (
                                <div key={post.id} className="bg-white border border-theme-primary/10 rounded-xl p-6 flex gap-6 shadow-sm">
                                    {/* Media Preview */}
                                    <div className="w-32 h-32 shrink-0 bg-stone-100 rounded-lg overflow-hidden relative">
                                        {post.mediaType === 'video' ? (
                                            <video src={post.videoUrl} className="w-full h-full object-cover" style={{ transform: `rotate(${post.rotation || 0}deg)` }} muted playsInline />
                                        ) : post.mediaType === 'audio' ? (
                                            <div className="w-full h-full flex items-center justify-center bg-theme-primary/90">
                                                <span className="material-symbols-outlined text-theme-accent text-3xl">mic</span>
                                            </div>
                                        ) : (
                                            <img src={post.imageUrl || post.thumbnailUrl} className="w-full h-full object-cover" />
                                        )}
                                    </div>
                                    
                                    {/* Content Details */}
                                    <div className="flex-1">
                                        <div className="flex justify-between mb-2">
                                            <div className="text-theme-primary font-bold">{post.labels?.[0] || 'Unknown Species'} <span className="text-theme-primary/50 font-normal">by {post.userName}</span></div>
                                            <div className="text-red-500 text-xs uppercase font-bold tracking-widest">Pending Review</div>
                                        </div>
                                        
                                        <div className="bg-stone-50 p-3 rounded-lg mb-4">
                                            <p className="text-theme-primary/80 text-sm italic">"{post.behavior}"</p>
                                        </div>

                                        <div className="mb-4">
                                            <h4 className="text-theme-primary/50 text-xs font-bold uppercase mb-2">Report Reasons:</h4>
                                            {post.reports?.map((r, i) => (
                                                <div key={i} className="text-red-600 text-sm flex gap-2 items-center">
                                                    <span className="material-symbols-outlined text-xs">flag</span>
                                                    {r.reason} 
                                                    <span className="text-theme-primary/40 text-xs ml-2">({new Date(r.timestamp).toLocaleDateString()})</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex gap-4">
                                            <button 
                                                onClick={() => handleDismissReport(post.id)}
                                                className="px-4 py-2 rounded-lg border border-theme-primary/20 text-theme-primary text-sm hover:bg-theme-primary/5 transition-colors"
                                            >
                                                Keep Content (Dismiss)
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteContent(post.id)}
                                                className="px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm hover:bg-red-100 transition-colors font-bold"
                                            >
                                                Delete & Moderate
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </main>
      </div>
    </div>
  );
};

export default AdminConsole;
