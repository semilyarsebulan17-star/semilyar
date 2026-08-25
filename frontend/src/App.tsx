import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { BottomNav, NavTab } from './components/BottomNav';
import { FeedView } from './views/FeedView';
import { DashboardView } from './views/DashboardView';
import { ProfileView } from './views/ProfileView';
import { ExploreView } from './views/ExploreView';
import { NotificationsView } from './views/NotificationsView';
import { SettingsView } from './views/SettingsView';
import { PromotionView } from './views/PromotionView';
import { NewsView } from './views/NewsView';
import { AdminDashboardView } from './views/AdminDashboardView';

// Modals & Drawers
import { TradeDetailModal } from './components/TradeDetailModal';
import { FollowSetupModal } from './components/FollowSetupModal';
import { AskAIModal } from './components/AskAIModal';
import { EnergyModal } from './components/EnergyModal';
import { ReferralModal } from './components/ReferralModal';
import { CommentsDrawer } from './components/CommentsDrawer';
import { EditDescriptionModal } from './components/EditDescriptionModal';
import { AuthModal } from './components/AuthModal';
import { KycVerificationModal } from './components/KycVerificationModal';
import { WithdrawalModal } from './components/WithdrawalModal';
import { CTraderGatewayModal } from './components/CTraderGatewayModal';
import { SubscriptionModal } from './components/SubscriptionModal';

import { User, FeedPost, Trade, Notification } from './types';
import { getStrategy } from './data/strategies';
import { triggerHaptic } from './utils/haptics';
import { feedCache } from './services/feedCache';
import { notificationClient } from './services/notificationClient';
import { socketClient, LivePositionUpdate, PositionClosedPayload } from './services/socketClient';
import { ShieldCheck, Zap, Lock, LogIn, ArrowRight } from 'lucide-react';

export default function App() {
  // Navigation State
  const [currentTab, setCurrentTab] = useState<NavTab | 'notifications'>('feed');
  const [viewingProfileUsername, setViewingProfileUsername] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminDashboardOpen, setIsAdminDashboardOpen] = useState(false);
  const [isPromotionViewOpen, setIsPromotionViewOpen] = useState(false);
  const [promoterUsername, setPromoterUsername] = useState<string | null>(null);

  // Core App Data State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMorePosts, setHasMorePosts] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

  const [users, setUsers] = useState<User[]>([]);
  const [liveTrades, setLiveTrades] = useState<Trade[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadBadgeCount, setUnreadBadgeCount] = useState<number>(0);

  // Modals Open State
  const [selectedDetailPost, setSelectedDetailPost] = useState<FeedPost | null>(null);
  const [selectedFollowSetupPost, setSelectedFollowSetupPost] = useState<FeedPost | null>(null);
  const [selectedAskAIPost, setSelectedAskAIPost] = useState<FeedPost | null>(null);
  const [selectedCommentsPost, setSelectedCommentsPost] = useState<FeedPost | null>(null);
  const [selectedEditDescPost, setSelectedEditDescPost] = useState<FeedPost | null>(null);
  const [isEnergyModalOpen, setIsEnergyModalOpen] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [isReferralModalOpen, setIsReferralModalOpen] = useState(false);
  const [isKycModalOpen, setIsKycModalOpen] = useState(false);
  const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState(false);
  const [isCTraderGatewayModalOpen, setIsCTraderGatewayModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const [initialReferralCode, setInitialReferralCode] = useState<string | null>(null);

  // Check URL pathname for `/@username` or query params on load
  useEffect(() => {
    const pathname = window.location.pathname;
    if (pathname.startsWith('/@')) {
      const username = pathname.slice(2);
      if (username) {
        setPromoterUsername(username);
        setIsPromotionViewOpen(true);
      }
    }
  }, []);

  // 1. Instant Cache Loading (IndexedDB First Strategy)
  useEffect(() => {
    async function loadLocalCache() {
      try {
        const cached = await feedCache.getCachedFeed();
        if (cached && cached.length > 0) {
          const enrichedCached = cached.map((p) => ({
            ...p,
            strategy: getStrategy(p.strategy?.id || p.trade?.strategyId || (p as any).strategyId)
          }));
          setPosts(enrichedCached);
        }
      } catch (e) {
        console.warn('[Cache] Could not load from IndexedDB:', e);
      }
    }
    loadLocalCache();
  }, []);

  // 2. Fetch fresh initial data from Express Server
  const fetchInitialData = async () => {
    try {
      // 2.1 Fetch current user session
      const savedUserId = localStorage.getItem('scrolic_user_id');
      const headers: Record<string, string> = {};
      if (savedUserId) {
        headers['x-session-user-id'] = savedUserId;
      }
      const meRes = await fetch('/api/user/me', { headers });
      const meData = await meRes.json();
      if (meData.user) {
        setCurrentUser(meData.user);
      }

      // 2.2 Fast Notification Snapshot (<100ms)
      if (savedUserId) {
        notificationClient.getSnapshot(savedUserId).then((snap) => {
          setUnreadBadgeCount(snap.unread_count);
        });
      }

      // 2.3 Fetch Feed posts with cursor pagination (first page)
      const feedRes = await fetch('/api/feed?limit=10');
      const feedData = await feedRes.json();
      if (feedData.posts) {
        const enrichedPosts = (feedData.posts as FeedPost[]).map((p) => ({
          ...p,
          strategy: getStrategy(p.strategy?.id || p.trade?.strategyId || (p as any).strategyId)
        }));
        setPosts(enrichedPosts);
        setNextCursor(feedData.next_cursor || null);
        setHasMorePosts(Boolean(feedData.has_more));

        // Update IndexedDB Cache in background
        feedCache.setCachedFeed(enrichedPosts);
      }

      // 2.4 Fetch Users
      const usersRes = await fetch('/api/users');
      const usersData = await usersRes.json();
      if (usersData.users) {
        setUsers(usersData.users);
      }

      // 2.5 Fetch Notifications & Snapshot
      const notifRes = await fetch('/api/notifications', { headers });
      const notifData = await notifRes.json();
      if (notifData.notifications) {
        setNotifications(notifData.notifications);
      }
      if (notifData.snapshot?.unread_count !== undefined) {
        setUnreadBadgeCount(notifData.snapshot.unread_count);
      }
    } catch (err) {
      console.error('Error fetching app data:', err);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  // 2.6 Realtime SSE Stream & Web Push Multi-Device Listener
  useEffect(() => {
    if (!currentUser?.id) return;

    // Register Web Push with VAPID
    notificationClient.registerPush(currentUser.id);

    // Connect Realtime SSE Stream
    const unsubscribeStream = notificationClient.connectRealtimeStream(currentUser.id, (event) => {
      if (event.type === 'NOTIFICATION_RECEIVED') {
        if (event.snapshot?.unread_count !== undefined) {
          setUnreadBadgeCount(event.snapshot.unread_count);
        } else {
          setUnreadBadgeCount((prev) => prev + 1);
        }
        if (event.notification) {
          setNotifications((prev) => {
            const exists = prev.some((n) => n.id === event.notification.id);
            if (exists) return prev;
            return [event.notification, ...prev];
          });
          triggerHaptic('success');
        }
      } else if (event.type === 'SNAPSHOT_UPDATED') {
        if (event.snapshot?.unread_count !== undefined) {
          setUnreadBadgeCount(event.snapshot.unread_count);
        }
        if (event.readNotificationId) {
          setNotifications((prev) =>
            prev.map((n) => (n.id === event.readNotificationId ? { ...n, isRead: true } : n))
          );
        } else if ((event as any).allRead) {
          setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        }
      }
    });

    // Handle Service Worker Notification Click Deep-Link message
    const handleSwMessage = (e: MessageEvent) => {
      if (e.data?.type === 'NOTIFICATION_CLICK_EVENT') {
        setCurrentTab('notifications');
        setIsPromotionViewOpen(false);
        setIsSettingsOpen(false);
        setIsAdminDashboardOpen(false);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);

    return () => {
      unsubscribeStream();
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
    };
  }, [currentUser?.id]);

  // 3. Infinite Scroll / Cursor Pagination: Fetch next page of posts
  const handleLoadMorePosts = async () => {
    if (!hasMorePosts || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);

    try {
      const res = await fetch(`/api/feed?limit=10&cursor=${encodeURIComponent(nextCursor)}`);
      const data = await res.json();

      if (data.posts && data.posts.length > 0) {
        const enrichedNew = (data.posts as FeedPost[]).map((p) => ({
          ...p,
          strategy: getStrategy(p.strategy?.id || p.trade?.strategyId || (p as any).strategyId)
        }));

        setPosts((prev) => {
          // Deduplicate by ID
          const existingIds = new Set(prev.map((p) => p.id));
          const toAdd = enrichedNew.filter((p) => !existingIds.has(p.id));
          const updated = [...prev, ...toAdd];
          feedCache.setCachedFeed(updated);
          return updated;
        });

        setNextCursor(data.next_cursor || null);
        setHasMorePosts(Boolean(data.has_more));
      } else {
        setHasMorePosts(false);
      }
    } catch (err) {
      console.error('Error loading more posts:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // 4. Real-time Socket.IO Live Feed & Position Update Subscriptions
  useEffect(() => {
    // Initialize socket connection
    socketClient.connect(currentUser?.id);

    // 4.1 On new post pushed by any trader via cTrader
    const unsubNewPost = socketClient.onNewPost((newPost: FeedPost) => {
      const enriched = {
        ...newPost,
        strategy: getStrategy(newPost.strategy?.id || newPost.trade?.strategyId || (newPost as any).strategyId)
      };

      setPosts((prev) => {
        const exists = prev.some((p) => p.id === enriched.id);
        if (exists) return prev;
        const updated = [enriched, ...prev];
        feedCache.setCachedFeed(updated);
        return updated;
      });

      triggerHaptic('success');
    });

    // 4.2 On position price/pips/PnL update from live cTrader ProtoOA tick
    const unsubPositionUpdate = socketClient.onPositionUpdate((update: LivePositionUpdate) => {
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id === update.postId || p.trade.id === update.postId) {
            return {
              ...p,
              trade: {
                ...p.trade,
                currentPrice: update.currentPrice,
                pips: update.pips,
                profitUSD: update.profit,
                profitPercent: update.profitPercent
              }
            };
          }
          return p;
        })
      );
    });

    // 4.3 On position closed settlement
    const unsubPositionClosed = socketClient.onPositionClosed((payload: PositionClosedPayload) => {
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id === payload.postId || p.trade.id === payload.postId) {
            return {
              ...p,
              trade: {
                ...p.trade,
                status: 'CLOSED',
                profitUSD: payload.profit,
                pips: payload.pips,
                closeTime: payload.closedAt
              }
            };
          }
          return p;
        })
      );
    });

    return () => {
      unsubNewPost();
      unsubPositionUpdate();
      unsubPositionClosed();
    };
  }, [currentUser?.id]);

  // Update liveTrades and closedTrades whenever posts change
  useEffect(() => {
    const opens: Trade[] = [];
    const closeds: Trade[] = [];

    posts.forEach((p) => {
      if (p.trade.status === 'OPEN') {
        opens.push(p.trade);
      } else {
        closeds.push(p.trade);
      }
    });

    setLiveTrades(opens);
    setClosedTrades(closeds);
  }, [posts]);

  // Auth gate helper
  const requireAuth = (reason: string, action: () => void) => {
    if (!currentUser) {
      setAuthPromptReason(reason);
      setIsAuthModalOpen(true);
      return;
    }
    action();
  };

  // --- Handlers ---

  // 1. Unlock Post with Energy
  const handleUnlockPost = async (post: FeedPost) => {
    requireAuth('Buka kunci Stop Loss & Take Profit tersembunyi dengan Energy', async () => {
      try {
        const res = await fetch(`/api/posts/${post.id}/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-user-id': currentUser?.id || '' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || data.error || 'Gagal membuka kunci post');

        // Update local post state
        setPosts((prev) =>
          prev.map((p) => (p.id === post.id ? { ...p, isUnlocked: true, trade: data.post?.trade || p.trade } : p))
        );
        // Update user energy balance
        if (data.energyBalance !== undefined && currentUser) {
          setCurrentUser({ ...currentUser, energyBalance: data.energyBalance });
        }
        triggerHaptic('success');
      } catch (err: any) {
        alert(err.message);
        if (err.message && err.message.includes('Energy tidak mencukupi')) {
          setIsEnergyModalOpen(true);
        }
      }
    });
  };

  // 2. Toggle Like
  const handleToggleLike = async (post: FeedPost) => {
    requireAuth('Masuk dengan Google untuk menyukai dan berinteraksi dengan trade', async () => {
      try {
        const res = await fetch(`/api/posts/${post.id}/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-user-id': currentUser?.id || '' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setPosts((prev) =>
          prev.map((p) =>
            p.id === post.id
              ? {
                  ...p,
                  isLiked: data.isLiked,
                  likesCount: data.likesCount
                }
              : p
          )
        );
      } catch (err: any) {
        console.error(err);
      }
    });
  };

  // 3. Toggle Save
  const handleToggleSave = async (post: FeedPost) => {
    requireAuth('Masuk dengan Google untuk menyimpan setup trade', async () => {
      try {
        const res = await fetch(`/api/posts/${post.id}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-user-id': currentUser?.id || '' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setPosts((prev) =>
          prev.map((p) => (p.id === post.id ? { ...p, isSaved: data.isSaved } : p))
        );
      } catch (err: any) {
        console.error(err);
      }
    });
  };

  // 4. Toggle Follow
  const handleToggleFollow = async (targetUsername: string) => {
    requireAuth('Masuk dengan Google untuk mengikuti trader', async () => {
      try {
        const res = await fetch(`/api/users/${targetUsername}/follow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-user-id': currentUser?.id || '' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // Update current user following list
        if (currentUser) {
          const list = new Set(currentUser.followingList || []);
          if (data.isFollowing) {
            list.add(targetUsername);
          } else {
            list.delete(targetUsername);
          }
          setCurrentUser({
            ...currentUser,
            followingList: Array.from(list),
            followingCount: data.isFollowing
              ? (currentUser.followingCount || 0) + 1
              : Math.max(0, (currentUser.followingCount || 1) - 1)
          });
        }

        // Update posts isFollowed
        setPosts((prev) =>
          prev.map((p) =>
            p.user.username === targetUsername
              ? {
                  ...p,
                  user: {
                    ...p.user,
                    followersCount: data.targetFollowersCount
                  },
                  isFollowed: data.isFollowing
                }
              : p
          )
        );

        // Update users list
        setUsers((prev) =>
          prev.map((u) =>
            u.username === targetUsername
              ? { ...u, followersCount: data.targetFollowersCount }
              : u
          )
        );
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  // 5. Mirror Trade execution callback
  const handleFollowExecuted = (orderEvent: any) => {
    triggerHaptic('success');
    fetchInitialData();
  };

  // 6. Comments added callback
  const handleCommentAdded = (postId: string, comment: any) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, commentsCount: (p.commentsCount || 0) + 1 } : p
      )
    );
  };

  // 7. Edit description saved callback
  const handleDescriptionSaved = (postId: string, newDescription: string, unlockFee?: number, followFee?: number) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              customDescription: newDescription,
              unlockFee: unlockFee !== undefined ? unlockFee : p.unlockFee,
              followFee: followFee !== undefined ? followFee : p.followFee
            }
          : p
      )
    );
  };

  // 8. Close Trade callback
  const handleCloseTrade = async (tradeId: string) => {
    try {
      const res = await fetch('/api/ctrader/positions/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-user-id': currentUser?.id || '' },
        body: JSON.stringify({ positionId: tradeId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menutup posisi');
      fetchInitialData();
      triggerHaptic('success');
    } catch (err: any) {
      alert(err.message);
    }
  };

  // 9. Notifications Mark All Read & Mark Single Read
  const handleMarkAllNotificationsAsRead = async () => {
    try {
      setUnreadBadgeCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { 'x-session-user-id': currentUser?.id || '' }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectNotification = async (notif: Notification) => {
    if (!notif.isRead) {
      try {
        setUnreadBadgeCount((prev) => Math.max(0, prev - 1));
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n))
        );
        await fetch(`/api/notifications/${notif.id}/read`, {
          method: 'POST',
          headers: { 'x-session-user-id': currentUser?.id || '' }
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  // 10. Login Success handler
  const handleLoginSuccess = (user: User) => {
    localStorage.setItem('scrolic_user_id', user.id || user.username);
    setCurrentUser(user);
    setIsAuthModalOpen(false);
    setAuthPromptReason(null);
    fetchInitialData();
  };

  // 11. Logout
  const handleLogout = async () => {
    try {
      localStorage.removeItem('scrolic_user_id');
      await fetch('/api/auth/logout', { method: 'POST' });
      setCurrentUser(null);
      setIsSettingsOpen(false);
      fetchInitialData();
    } catch (e) {
      console.error(e);
    }
  };

  // 12. User Update
  const handleUpdateUser = (updatedUser: User) => {
    setCurrentUser(updatedUser);
    setUsers((prev) => prev.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
    setPosts((prev) =>
      prev.map((p) =>
        p.userId === updatedUser.id ? { ...p, user: { ...p.user, ...updatedUser } } : p
      )
    );
  };

  // Active target user for profile view
  const activeProfileUser = viewingProfileUsername
    ? users.find((u) => u.username === viewingProfileUsername) || currentUser
    : currentUser;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="min-h-screen bg-[#050505] text-neutral-100 font-sans antialiased flex flex-col selection:bg-amber-500 selection:text-black">
      
      {/* Top Navbar */}
      <Navbar
        currentUser={currentUser}
        unreadNotificationsCount={unreadBadgeCount}
        onOpenEnergy={() => setIsEnergyModalOpen(true)}
        onOpenNotifications={() => {
          setCurrentTab('notifications');
          setIsPromotionViewOpen(false);
          setIsSettingsOpen(false);
          setIsAdminDashboardOpen(false);
        }}
        onOpenLogin={() => {
          setAuthPromptReason(null);
          setIsAuthModalOpen(true);
        }}
        onOpenPromotion={() => {
          setPromoterUsername(currentUser ? currentUser.username : 'alex_trader');
          setIsPromotionViewOpen(true);
          setIsAdminDashboardOpen(false);
          setIsSettingsOpen(false);
        }}
        onOpenAdmin={() => {
          setIsAdminDashboardOpen(true);
          setIsPromotionViewOpen(false);
          setIsSettingsOpen(false);
        }}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 w-full max-w-md mx-auto pt-2">
        {/* Promotion / Landing View */}
        {isAdminDashboardOpen ? (
          <AdminDashboardView
            currentUser={currentUser}
            onBackToFeed={() => {
              setIsAdminDashboardOpen(false);
              setCurrentTab('feed');
            }}
            onRefreshCurrentUser={fetchInitialData}
          />
        ) : isPromotionViewOpen ? (
          <PromotionView
            promoterUser={
              promoterUsername
                ? users.find((u) => u.username === promoterUsername) || currentUser
                : currentUser
            }
            currentUser={currentUser}
            onOpenLogin={(refCode) => {
              if (refCode) setInitialReferralCode(refCode);
              setAuthPromptReason('Klaim bonus 25 Energy & diskon copy trade');
              setIsAuthModalOpen(true);
            }}
            onBackToFeed={() => {
              setIsPromotionViewOpen(false);
              setCurrentTab('feed');
            }}
            onOpenReferralModal={() => setIsReferralModalOpen(true)}
          />
        ) : isSettingsOpen ? (
          <SettingsView
            currentUser={currentUser}
            onUpdateUser={handleUpdateUser}
            onOpenEnergy={() => setIsEnergyModalOpen(true)}
            onOpenReferral={() => setIsReferralModalOpen(true)}
            onOpenSubscription={() => setIsSubscriptionModalOpen(true)}
            onOpenKycModal={() => setIsKycModalOpen(true)}
            onOpenWithdrawalModal={() => setIsWithdrawalModalOpen(true)}
            onOpenAdmin={() => {
              setIsAdminDashboardOpen(true);
              setIsSettingsOpen(false);
            }}
            onLogout={handleLogout}
          />
        ) : currentTab === 'feed' ? (
          <FeedView
            posts={posts}
            currentUser={currentUser}
            hasMore={hasMorePosts}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMorePosts}
            onUnlockPost={handleUnlockPost}
            onOpenDetail={(post) => setSelectedDetailPost(post)}
            onOpenFollowSetup={(post) => {
              requireAuth('Masuk dengan Google untuk mirror follow trade', () => {
                setSelectedFollowSetupPost(post);
              });
            }}
            onOpenAskAI={(post) => {
              requireAuth('Tanya Gemini AI untuk validasi setup teknikal', () => {
                setSelectedAskAIPost(post);
              });
            }}
            onOpenComments={(post) => setSelectedCommentsPost(post)}
            onToggleLike={handleToggleLike}
            onToggleSave={handleToggleSave}
            onToggleFollow={handleToggleFollow}
            onEditDescription={(post) => setSelectedEditDescPost(post)}
            onViewProfile={(username) => {
              setViewingProfileUsername(username);
              setCurrentTab('profile');
            }}
            onRefreshFeed={fetchInitialData}
            onOpenLogin={() => {
              setAuthPromptReason(null);
              setIsAuthModalOpen(true);
            }}
          />
        ) : currentTab === 'explore' ? (
          <ExploreView
            users={users}
            posts={posts}
            currentUser={currentUser}
            onViewProfile={(username) => {
              setViewingProfileUsername(username);
              setCurrentTab('profile');
            }}
            onToggleFollow={handleToggleFollow}
            onOpenDetail={(post) => setSelectedDetailPost(post)}
            onOpenPromotionPage={(username) => {
              setPromoterUsername(username);
              setIsPromotionViewOpen(true);
            }}
          />
        ) : currentTab === 'dashboard' ? (
          <DashboardView
            currentUser={currentUser}
            liveTrades={liveTrades}
            closedTrades={closedTrades}
            posts={posts}
            onOpenEnergy={() => setIsEnergyModalOpen(true)}
            onOpenReferral={() => setIsReferralModalOpen(true)}
            onOpenCTraderGateway={() => setIsCTraderGatewayModalOpen(true)}
            onUpdateUser={handleUpdateUser}
            onCloseTrade={handleCloseTrade}
            onOpenLogin={() => {
              setAuthPromptReason('Masuk untuk mengakses Dashboard cTrader & portofolio');
              setIsAuthModalOpen(true);
            }}
          />
        ) : currentTab === 'news' ? (
          <NewsView
            currentUser={currentUser}
            onOpenEnergy={() => setIsEnergyModalOpen(true)}
            onOpenLogin={() => {
              setAuthPromptReason('Masuk dengan Google untuk menggunakan fitur Tanya AI Berita');
              setIsAuthModalOpen(true);
            }}
            onUpdateEnergyBalance={(newBalance) => {
              if (currentUser) {
                setCurrentUser({ ...currentUser, energyBalance: newBalance });
              }
            }}
          />
        ) : currentTab === 'notifications' ? (
          <NotificationsView
            notifications={notifications}
            currentUser={currentUser}
            onMarkAllAsRead={handleMarkAllNotificationsAsRead}
            onSelectNotification={handleSelectNotification}
            onOpenEnergy={() => setIsEnergyModalOpen(true)}
            onOpenReferral={() => setIsReferralModalOpen(true)}
          />
        ) : currentTab === 'profile' && activeProfileUser ? (
          <ProfileView
            user={activeProfileUser}
            currentUser={currentUser}
            posts={posts}
            liveTrades={liveTrades}
            closedTrades={closedTrades}
            onUnlockPost={handleUnlockPost}
            onOpenDetail={(post) => setSelectedDetailPost(post)}
            onOpenFollowSetup={(post) => {
              requireAuth('Masuk untuk mirror follow trade', () => {
                setSelectedFollowSetupPost(post);
              });
            }}
            onOpenAskAI={(post) => {
              requireAuth('Tanya AI untuk setup ini', () => {
                setSelectedAskAIPost(post);
              });
            }}
            onOpenComments={(post) => setSelectedCommentsPost(post)}
            onToggleLike={handleToggleLike}
            onToggleSave={handleToggleSave}
            onToggleFollow={handleToggleFollow}
            onEditDescription={(post) => setSelectedEditDescPost(post)}
            onOpenEnergy={() => setIsEnergyModalOpen(true)}
            onOpenReferral={() => setIsReferralModalOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenLogin={() => {
              setAuthPromptReason(null);
              setIsAuthModalOpen(true);
            }}
            onOpenPromotionPage={(username) => {
              setPromoterUsername(username);
              setIsPromotionViewOpen(true);
            }}
            onOpenWithdrawalModal={() => setIsWithdrawalModalOpen(true)}
            onOpenKycModal={() => setIsKycModalOpen(true)}
            onUpdateUser={handleUpdateUser}
          />
        ) : currentTab === 'profile' && !activeProfileUser ? (
          /* Guest Profile Prompt: Elegant login gate when user is logged out */
          <div className="w-full max-w-md mx-auto p-4 pb-24 text-center">
            <div className="bg-[#07130c] border border-[#18633c]/40 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 text-emerald-400">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-black text-white mb-2">Profil & Portofolio cTrader</h3>
              <p className="text-xs text-neutral-400 max-w-xs mx-auto mb-6 leading-relaxed">
                Masuk untuk melihat statistik trading Anda, menghubungkan akun cTrader Open API, serta mengelola komisi afiliasi 5 generasi.
              </p>

              <button
                onClick={() => {
                  triggerHaptic('medium');
                  setAuthPromptReason('Masuk untuk mengakses profil dan menghubungkan cTrader');
                  setIsAuthModalOpen(true);
                }}
                className="w-full py-3 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all active:scale-95 cursor-pointer mb-3"
              >
                <LogIn className="w-4 h-4" />
                <span>Masuk dengan Google</span>
                <ArrowRight className="w-4 h-4 ml-auto" />
              </button>

              <div className="flex items-center justify-center gap-4 text-[10px] text-neutral-400 pt-2 border-t border-white/5">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-400" /> +25 Energy Gratis
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Lock className="w-3 h-3 text-emerald-400" /> cTrader API Aman
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* Bottom Sticky Navigation */}
      <BottomNav
        currentTab={currentTab}
        onChangeTab={(tab) => {
          if (tab === 'profile' && !currentUser) {
            // If user is not logged in, prompt auth or switch to profile prompt
            setViewingProfileUsername(null);
            setCurrentTab('profile');
            return;
          }
          setCurrentTab(tab);
          setIsPromotionViewOpen(false);
          setIsSettingsOpen(false);
          setIsAdminDashboardOpen(false);
          if (tab === 'profile') {
            setViewingProfileUsername(null); // Reset to own profile
          }
        }}
        unreadCount={unreadCount}
      />

      {/* --- MODALS & DRAWERS --- */}

      {/* 1. Trade Detail Modal */}
      {selectedDetailPost && (
        <TradeDetailModal
          post={selectedDetailPost}
          currentUser={currentUser}
          onClose={() => setSelectedDetailPost(null)}
          onUnlock={handleUnlockPost}
          onOpenFollowSetup={(post) => {
            setSelectedDetailPost(null);
            requireAuth('Masuk untuk follow trade', () => {
              setSelectedFollowSetupPost(post);
            });
          }}
          onOpenAskAI={(post) => {
            setSelectedDetailPost(null);
            requireAuth('Tanya AI untuk setup ini', () => {
              setSelectedAskAIPost(post);
            });
          }}
        />
      )}

      {/* 2. Follow Setup Modal */}
      {selectedFollowSetupPost && (
        <FollowSetupModal
          post={selectedFollowSetupPost}
          currentUser={currentUser}
          onClose={() => setSelectedFollowSetupPost(null)}
          onNavigateToDashboard={() => {
            setSelectedFollowSetupPost(null);
            setSelectedDetailPost(null);
            setIsSettingsOpen(false);
            setIsPromotionViewOpen(false);
            setViewingProfileUsername(null);
            setCurrentTab('dashboard');
          }}
          onFollowExecuted={handleFollowExecuted}
          onOpenEnergyModal={() => {
            setSelectedFollowSetupPost(null);
            setIsEnergyModalOpen(true);
          }}
          onOpenCTraderModal={() => {
            setSelectedFollowSetupPost(null);
            setIsCTraderGatewayModalOpen(true);
          }}
        />
      )}

      {/* 3. Ask AI Modal (Gemini 2.5) */}
      {selectedAskAIPost && (
        <AskAIModal
          post={selectedAskAIPost}
          currentUser={currentUser}
          onClose={() => setSelectedAskAIPost(null)}
          onEnergyDeducted={(newBalance) => {
            if (currentUser) {
              setCurrentUser({ ...currentUser, energyBalance: newBalance });
            }
          }}
        />
      )}

      {/* 4. Comments Drawer */}
      {selectedCommentsPost && (
        <CommentsDrawer
          post={selectedCommentsPost}
          currentUser={currentUser}
          onClose={() => setSelectedCommentsPost(null)}
          onCommentAdded={handleCommentAdded}
        />
      )}

      {/* 5. Edit Description Modal */}
      {selectedEditDescPost && (
        <EditDescriptionModal
          post={selectedEditDescPost}
          currentUser={currentUser}
          onClose={() => setSelectedEditDescPost(null)}
          onSave={handleDescriptionSaved}
          onOpenSubscription={() => setIsEnergyModalOpen(true)}
        />
      )}

      {/* 6. Energy Wallet Modal (Mayar.id integration) */}
      {isEnergyModalOpen && currentUser && (
        <EnergyModal
          currentUser={currentUser}
          onClose={() => setIsEnergyModalOpen(false)}
          onOpenWithdrawalModal={() => {
            setIsEnergyModalOpen(false);
            setIsWithdrawalModalOpen(true);
          }}
          onOpenKycModal={() => {
            setIsEnergyModalOpen(false);
            setIsKycModalOpen(true);
          }}
          onTopupSuccess={(newBalance) => {
            if (currentUser) {
              setCurrentUser({ ...currentUser, energyBalance: newBalance, energy: newBalance });
            }
          }}
        />
      )}

      {/* 6.5. VIP Subscription Modal (Pay with Energy) */}
      {isSubscriptionModalOpen && currentUser && (
        <SubscriptionModal
          currentUser={currentUser}
          onClose={() => setIsSubscriptionModalOpen(false)}
          onOpenEnergyModal={() => {
            setIsSubscriptionModalOpen(false);
            setIsEnergyModalOpen(true);
          }}
          onSuccess={(updatedUser) => {
            handleUpdateUser(updatedUser);
          }}
        />
      )}

      {/* 7. Referral Network Modal (5 Generations) */}
      {isReferralModalOpen && currentUser && (
        <ReferralModal
          currentUser={currentUser}
          onClose={() => setIsReferralModalOpen(false)}
          onOpenPromotionPage={(username) => {
            setIsReferralModalOpen(false);
            setPromoterUsername(username);
            setIsPromotionViewOpen(true);
          }}
          onOpenWithdrawalModal={() => {
            setIsReferralModalOpen(false);
            setIsWithdrawalModalOpen(true);
          }}
          onOpenKycModal={() => {
            setIsReferralModalOpen(false);
            setIsKycModalOpen(true);
          }}
        />
      )}

      {/* 8. KYC AI Verification Modal (Gemini OCR) */}
      {isKycModalOpen && currentUser && (
        <KycVerificationModal
          currentUser={currentUser}
          onClose={() => setIsKycModalOpen(false)}
          onVerificationSuccess={(updatedUser) => {
            handleUpdateUser(updatedUser);
          }}
          onProceedToWithdraw={() => {
            setIsWithdrawalModalOpen(true);
          }}
        />
      )}

      {/* 9. Commission Withdrawal Modal (Instant BI-FAST) */}
      {isWithdrawalModalOpen && currentUser && (
        <WithdrawalModal
          currentUser={currentUser}
          onClose={() => setIsWithdrawalModalOpen(false)}
          onOpenKycModal={() => {
            setIsKycModalOpen(true);
          }}
          onWithdrawalSuccess={(newBalance) => {
            setCurrentUser({
              ...currentUser,
              energyBalance: newBalance,
              energy: newBalance
            });
          }}
        />
      )}

      {/* 10. cTrader Open API Gateway Modal */}
      {isCTraderGatewayModalOpen && currentUser && (
        <CTraderGatewayModal
          currentUser={currentUser}
          onClose={() => setIsCTraderGatewayModalOpen(false)}
          onUpdateUser={(updated) => {
            handleUpdateUser(updated);
          }}
        />
      )}

      {/* 11. Authentication Modal (Google 1-Tap) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        promptReason={authPromptReason}
        initialReferralCode={initialReferralCode}
      />
    </div>
  );
}
