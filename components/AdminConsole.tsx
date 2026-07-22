
import React, { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebaseService';
import { GeminiConfig, CommunityPost, UserProfileData, AiUsageLogEntry } from '../types';
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
  const [activeTab, setActiveTab] = useState<'activity' | 'moderation' | 'usage'>('activity');

  // Moderation Data
  const [reportedPosts, setReportedPosts] = useState<CommunityPost[]>([]);

  // Activity / Log Tracking Data
  const [allUsers, setAllUsers] = useState<UserProfileData[]>([]);
  const [allPosts, setAllPosts] = useState<CommunityPost[]>([]);

  // AI Cost/Usage Telemetry Data
  const [aiUsageLogs, setAiUsageLogs] = useState<AiUsageLogEntry[]>([]);

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

  const loadAiUsage = async () => {
      setStatus('Loading AI usage telemetry...');
      try {
          const logs = await FirebaseService.getRecentAiUsage(500);
          setAiUsageLogs(logs);
          setStatus('');
      } catch (e: any) {
          setStatus('Failed loading AI usage telemetry: ' + e.message);
      }
  };

  useEffect(() => {
      if (isAuthenticated) {
          if (activeTab === 'moderation') {
              loadReportedPosts();
          } else if (activeTab === 'activity') {
              loadActivityLogs();
          } else if (activeTab === 'usage') {
              loadAiUsage();
          }
      }
  }, [isAuthenticated, activeTab]);

  const handleSave = async () => {
    if (!config) return;
    setStatus('Saving...');
    try {
        await FirebaseService.updateGeminiConfig(config);
        setStatus('Configuration updated successfully.');
    } catch (e) {
        setStatus('Save failed. Ensure you are authenticated in Firebase.');
    }
  };

  const handleDismissReport = async (postId: string) => {
      await FirebaseService.dismissReports(postId);
      setReportedPosts(prev => prev.filter(p => p.id !== postId));
      setStatus('Report dismissed. Content kept.');
  };

  const handleDeleteContent = async (postId: string) => {
      if(window.confirm("Are you sure you want to permanently delete this content?")) {
          try {
              // Optimistic update
              setReportedPosts(prev => prev.filter(p => p.id !== postId));
              setAllPosts(prev => prev.filter(p => p.id !== postId));
              
              await FirebaseService.deletePost(postId);
              setStatus('Content deleted from ecosystem.');
          } catch (e) {
              setStatus('Failed to delete content.');
              // Re-fetch reports if failure occurs
              loadReportedPosts();
          }
      }
  };

  const handleSignOut = () => {
    FirebaseService.logout();
    onBack();
  };

  const downloadMetadataCSV = () => {
      if (allPosts.length === 0) {
          setStatus('No data available to export.');
          return;
      }
      
      const headers = [
          'Post ID', 'User ID', 'User Name', 'Media Type', 'Species', 'Behavior', 
          'Timestamp', 'Location Area', 'Raw Lat', 'Raw Lng', 'Time To Record (ms)', 
          'Session Retakes', 'AI Proposed Labels', 'AI Proposed Behavior', 'Human Delta', 
          'Likes', 'Comments', 'Reports'
      ];
      
      const rows = allPosts.map(post => {
          const ts = post.timestamp?.toMillis ? post.timestamp.toMillis() : (post.timestamp?.seconds ? post.timestamp.seconds * 1000 : post.timestamp);
          const dateStr = ts ? new Date(ts).toISOString() : '';
          return [
              post.id,
              post.userId,
              `"${(post.userName || '').replace(/"/g, '""')}"`,
              post.mediaType,
              `"${(post.labels?.join(', ') || '').replace(/"/g, '""')}"`,
              `"${(post.behavior || '').replace(/"/g, '""')}"`,
              dateStr,
              `"${(post.locationArea || '').replace(/"/g, '""')}"`,
              post.rawLocation?.lat || '',
              post.rawLocation?.lng || '',
              post.timeToRecordMs || '',
              post.sessionRetakes || '',
              `"${(post.aiProposedLabels?.join(', ') || '').replace(/"/g, '""')}"`,
              `"${(post.aiProposedBehavior || '').replace(/"/g, '""')}"`,
              post.humanDelta ? 'true' : 'false',
              post.likes?.length || 0,
              post.commentCount || 0,
              post.reportCount || 0
          ].join(',');
      });
      
      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `naturegram_metadata_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
            <h1 className="text-xl font-bold font-display italic tracking-tight text-theme-primary">Admin Console</h1>
        </div>
        <div className="flex items-center gap-4">
            <span className="text-theme-primary/40 text-sm font-bold uppercase tracking-widest">{status}</span>
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
        <aside className="w-64 border-r border-theme-primary/10 bg-black/[0.02] p-4 shrink-0">
            <h3 className="text-white/40 text-xs font-bold uppercase tracking-wider mb-4">Modules</h3>
            <div className="flex flex-col gap-2">
                <button 
                    onClick={() => setActiveTab('activity')}
                    className={`text-left px-4 py-3 rounded-lg flex items-center gap-3 ${activeTab === 'activity' ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30' : 'text-stone-400 hover:bg-white/5'}`}
                >
                    <span className="material-symbols-outlined text-sm">analytics</span>
                    Activity Logs
                </button>
                <button
                    onClick={() => setActiveTab('moderation')}
                    className={`text-left px-4 py-3 rounded-lg flex items-center gap-3 ${activeTab === 'moderation' ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30' : 'text-stone-400 hover:bg-white/5'}`}
                >
                    <span className="material-symbols-outlined text-sm">gavel</span>
                    Moderation
                    {reportedPosts.length > 0 && <span className="ml-auto bg-red-500 text-white text-[10px] px-1.5 rounded-full">{reportedPosts.length}</span>}
                </button>
                <button
                    onClick={() => setActiveTab('usage')}
                    className={`text-left px-4 py-3 rounded-lg flex items-center gap-3 ${activeTab === 'usage' ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30' : 'text-stone-400 hover:bg-white/5'}`}
                >
                    <span className="material-symbols-outlined text-sm">query_stats</span>
                    AI Usage
                </button>
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
            
            {/* CONFIG AND MAINT DELETED */}

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
                                            {/* Fix: Access first element of labels array instead of deprecated label property */}
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

            {/* AI USAGE / COST TELEMETRY TAB */}
            {activeTab === 'usage' && (() => {
                const totalCalls = aiUsageLogs.length;
                const totalTokens = aiUsageLogs.reduce((sum, l) => sum + (l.totalTokenCount || ((l.promptTokenCount || 0) + (l.candidatesTokenCount || 0))), 0);

                const byModel = new Map<string, { count: number, tokens: number }>();
                const byFeature = new Map<string, { count: number, tokens: number }>();
                aiUsageLogs.forEach(l => {
                    const tokens = l.totalTokenCount || ((l.promptTokenCount || 0) + (l.candidatesTokenCount || 0));
                    const model = byModel.get(l.model) || { count: 0, tokens: 0 };
                    model.count += 1;
                    model.tokens += tokens;
                    byModel.set(l.model, model);

                    const feature = byFeature.get(l.feature) || { count: 0, tokens: 0 };
                    feature.count += 1;
                    feature.tokens += tokens;
                    byFeature.set(l.feature, feature);
                });

                const formatTime = (ts: any) => {
                    if (!ts) return 'Just now';
                    if (typeof ts.toDate === 'function') return ts.toDate().toLocaleString();
                    return new Date(ts).toLocaleString();
                };

                return (
                    <div className="max-w-6xl mx-auto flex flex-col gap-8">
                        <div className="flex justify-between items-center bg-white shadow-sm border border-theme-primary/10 rounded-2xl p-6">
                            <div>
                                <h2 className="text-theme-primary text-2xl font-black tracking-tight flex items-center gap-2 font-display italic">
                                    <span className="material-symbols-outlined text-theme-accent">query_stats</span>
                                    AI Cost & Usage Telemetry
                                </h2>
                                <p className="text-theme-primary/50 text-xs mt-1">
                                    Client-reported Gemini call volume and token usage (last {aiUsageLogs.length} calls). Self-reported, not an authoritative billing source — cross-check against Cloud Billing for real cost figures.
                                </p>
                            </div>
                            <button
                                onClick={loadAiUsage}
                                className="bg-theme-primary/5 hover:bg-theme-primary/10 border border-theme-primary/10 text-theme-primary rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs font-black uppercase tracking-widest transition-all"
                            >
                                <span className="material-symbols-outlined text-sm">sync</span>
                                Refresh
                            </button>
                        </div>

                        {/* SUMMARY STACK */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            <div className="bg-white border border-theme-primary/10 p-6 rounded-[2rem] shadow-sm flex items-center gap-5">
                                <div className="w-12 h-12 rounded-2xl bg-theme-accent/10 flex items-center justify-center text-theme-accent shrink-0">
                                    <span className="material-symbols-outlined text-2xl">call</span>
                                </div>
                                <div>
                                    <p className="text-theme-primary/40 text-[9px] font-black uppercase tracking-widest">AI Calls Logged</p>
                                    <p className="text-2xl font-black text-theme-primary">{totalCalls}</p>
                                </div>
                            </div>

                            <div className="bg-white border border-theme-primary/10 p-6 rounded-[2rem] shadow-sm flex items-center gap-5">
                                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-600 shrink-0">
                                    <span className="material-symbols-outlined text-2xl">token</span>
                                </div>
                                <div>
                                    <p className="text-theme-primary/40 text-[9px] font-black uppercase tracking-widest">Total Tokens</p>
                                    <p className="text-2xl font-black text-theme-primary">{totalTokens.toLocaleString()}</p>
                                </div>
                            </div>

                            <div className="bg-white border border-theme-primary/10 p-6 rounded-[2rem] shadow-sm flex items-center gap-5">
                                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0">
                                    <span className="material-symbols-outlined text-2xl">bolt</span>
                                </div>
                                <div>
                                    <p className="text-theme-primary/40 text-[9px] font-black uppercase tracking-widest">Models In Use</p>
                                    <p className="text-2xl font-black text-theme-primary">{byModel.size}</p>
                                </div>
                            </div>

                            <div className="bg-white border border-theme-primary/10 p-6 rounded-[2rem] shadow-sm flex items-center gap-5">
                                <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-500 shrink-0">
                                    <span className="material-symbols-outlined text-2xl">category</span>
                                </div>
                                <div>
                                    <p className="text-theme-primary/40 text-[9px] font-black uppercase tracking-widest">Features Tracked</p>
                                    <p className="text-2xl font-black text-theme-primary">{byFeature.size}</p>
                                </div>
                            </div>
                        </div>

                        {/* BREAKDOWN + RECENT CALLS */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                            {/* Breakdown by model/feature */}
                            <div className="lg:col-span-4 bg-white border border-theme-primary/10 rounded-3xl p-6 flex flex-col h-[500px] shadow-sm">
                                <h3 className="text-theme-primary font-black text-[10px] uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-xs text-theme-primary/50">bar_chart</span>
                                    Usage By Model
                                </h3>
                                <div className="flex-1 overflow-y-auto space-y-3 pr-2 no-scrollbar">
                                    {Array.from(byModel.entries()).sort((a, b) => b[1].tokens - a[1].tokens).map(([model, stats]) => (
                                        <div key={model} className="bg-stone-50 border border-theme-primary/10 rounded-2xl p-4">
                                            <p className="text-stone-800 font-bold text-xs truncate">{model}</p>
                                            <p className="text-theme-primary/50 text-[9px] mt-1">{stats.count} calls • {stats.tokens.toLocaleString()} tokens</p>
                                        </div>
                                    ))}
                                    {byModel.size === 0 && (
                                        <div className="h-full flex items-center justify-center text-theme-primary/30 italic text-sm">No usage logged yet.</div>
                                    )}
                                </div>

                                <h3 className="text-theme-primary font-black text-[10px] uppercase tracking-widest my-4 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-xs text-theme-primary/50">category</span>
                                    Usage By Feature
                                </h3>
                                <div className="flex-1 overflow-y-auto space-y-3 pr-2 no-scrollbar">
                                    {Array.from(byFeature.entries()).sort((a, b) => b[1].tokens - a[1].tokens).map(([feature, stats]) => (
                                        <div key={feature} className="bg-stone-50 border border-theme-primary/10 rounded-2xl p-4">
                                            <p className="text-stone-800 font-bold text-xs truncate">{feature}</p>
                                            <p className="text-theme-primary/50 text-[9px] mt-1">{stats.count} calls • {stats.tokens.toLocaleString()} tokens</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Recent calls list */}
                            <div className="lg:col-span-8 bg-white border border-theme-primary/10 rounded-3xl p-6 flex flex-col h-[500px] shadow-sm">
                                <h3 className="text-theme-primary font-black text-[10px] uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-xs text-theme-primary/50">history</span>
                                    Recent AI Calls ({aiUsageLogs.length})
                                </h3>
                                <div className="flex-1 overflow-y-auto space-y-3 pr-1 no-scrollbar">
                                    {aiUsageLogs.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-theme-primary/30 italic text-sm font-display tracking-wide">
                                            No AI usage logged yet.
                                        </div>
                                    ) : (
                                        aiUsageLogs.map((log, idx) => (
                                            <div key={log.id || idx} className="bg-stone-50 border border-theme-primary/10 rounded-2xl p-4 flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                    <p className="text-stone-800 font-bold text-xs truncate">{log.feature} <span className="text-theme-primary/40 font-normal">via {log.model}</span></p>
                                                    <p className="text-theme-primary/40 text-[9px] mt-0.5">{formatTime(log.timestamp)} • uid: {log.uid.slice(0, 8)}</p>
                                                </div>
                                                <span className="bg-white/5 border border-theme-primary/10 text-theme-primary/70 px-2 py-1 rounded text-[8px] font-bold shrink-0">
                                                    {(log.totalTokenCount || ((log.promptTokenCount || 0) + (log.candidatesTokenCount || 0))).toLocaleString()} tok
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* MAINTENANCE DELETED */}
        </main>
      </div>
    </div>
  );
};

export default AdminConsole;
