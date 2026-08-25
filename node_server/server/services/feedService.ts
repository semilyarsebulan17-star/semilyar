import { postRepository, FeedQueryOptions } from '../repositories/postRepository';
import { userRepository } from '../repositories/userRepository';
import { interactionRepository } from '../repositories/interactionRepository';
import { MongoPost } from '../models/types';

export interface EnrichedFeedPost {
  id: string;
  userId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatar: string;
    isVerified: boolean;
    winRate: number;
    followersCount: number;
    subscriptionTier: string;
    strategyDNA: string;
    primaryStrategyId?: string;
  };
  trade: {
    id: string;
    userId: string;
    cTraderPositionId?: number;
    symbol: string;
    direction: 'BUY' | 'SELL';
    entryPrice: number | null;
    currentPrice: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    volumeLot: number | null;
    profitUSD: number;
    pips: number;
    profitPercent: number;
    status: 'OPEN' | 'CLOSED';
    openTime: string;
    closeTime?: string | null;
    duration: string;
    strategyId: string;
    comment?: string;
  };
  strategy: {
    id: string;
    name: string;
    tagline: string;
  };
  autoDescription: string;
  customDescription?: string;
  isUnlocked: boolean;
  unlockFee: number;
  followFee: number;
  likesCount: number;
  commentsCount: number;
  followersCount: number;
  isLiked: boolean;
  isSaved: boolean;
  isFollowed: boolean;
  isFollowingSetup?: boolean;
  createdAt: string;
}

export class FeedService {
  async getFeed(options: FeedQueryOptions, currentUserId: string | null): Promise<{
    posts: EnrichedFeedPost[];
    next_cursor: string | null;
    has_more: boolean;
    total_count: number;
  }> {
    // If following tab requested, resolve following usernames
    if (options.userFilterList === undefined && currentUserId) {
      const currentUser = await userRepository.findById(currentUserId);
      if (currentUser && currentUser.following_list) {
        options.userFilterList = currentUser.following_list;
      }
    }

    const { posts, nextCursor, hasMore, totalCount } = await postRepository.findFeedWithCursor(options);

    // Concurrently enrich posts and enforce security masking
    const enrichedList = await Promise.all(
      posts.map((post) => this.enrichAndMaskPost(post, currentUserId))
    );

    return {
      posts: enrichedList,
      next_cursor: nextCursor,
      has_more: hasMore,
      total_count: totalCount
    };
  }

  async getPostById(postId: string, currentUserId: string | null): Promise<EnrichedFeedPost | null> {
    const post = await postRepository.findById(postId);
    if (!post) return null;
    return await this.enrichAndMaskPost(post, currentUserId);
  }

  private async enrichAndMaskPost(post: MongoPost, currentUserId: string | null): Promise<EnrichedFeedPost> {
    const author = (await userRepository.findById(post.user_id)) || (await userRepository.findByUsername(post.username));
    const isOwner = Boolean(currentUserId && (currentUserId === post.user_id || (author && currentUserId === author.id)));
    
    // Check unlock status from interaction repository
    const hasUnlocked = currentUserId ? await interactionRepository.isUnlocked(currentUserId, post.id || post._id.toString()) : false;
    const isUnlocked = post.visibility === 'PUBLIC' || isOwner || hasUnlocked;

    // Likes, Saved, Following
    const isLiked = currentUserId ? await interactionRepository.isLiked(post.id || post._id.toString(), currentUserId) : false;
    const isFollowed = currentUserId && author ? await interactionRepository.isFollowing(currentUserId, author.username) : false;
    const isSaved = false;

    // Security Masking: If locked and not unlocked, completely withhold SL, TP, exact Entry, Lot from JSON
    const safeStopLoss = isUnlocked ? post.stop_loss : undefined;
    const safeTakeProfit = isUnlocked ? post.take_profit : undefined;
    const safeEntryPrice = isUnlocked ? post.entry_price : (post.status === 'CLOSED' ? post.entry_price : post.current_price);
    const safeVolumeLot = isUnlocked ? post.lot : null;

    const isFollowingSetup = Boolean(currentUserId && post.followed_by_user_ids && post.followed_by_user_ids.includes(currentUserId));

    return {
      id: post.id || post._id.toString(),
      userId: post.user_id,
      user: {
        id: author?.id || post.user_id,
        username: author?.username || post.username,
        displayName: author?.display_name || post.username,
        avatar: author?.avatar || post.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${post.username}`,
        isVerified: author?.is_verified ?? true,
        winRate: author?.win_rate ?? 75.0,
        followersCount: author?.followers_count ?? 0,
        subscriptionTier: author?.subscription_tier || 'free',
        strategyDNA: author?.strategy_dna || post.strategy_id,
        primaryStrategyId: author?.primary_strategy_id || post.strategy_id
      },
      trade: {
        id: post.trade_id || `trade-${post.id}`,
        userId: post.user_id,
        cTraderPositionId: 8810000 + Math.abs(post._id.toString().charCodeAt(0)),
        symbol: post.symbol,
        direction: post.position_type,
        entryPrice: safeEntryPrice,
        currentPrice: post.current_price,
        stopLoss: safeStopLoss,
        takeProfit: safeTakeProfit,
        volumeLot: safeVolumeLot,
        profitUSD: post.profit,
        pips: post.pips ?? 0,
        profitPercent: post.profit_percent,
        status: post.status,
        openTime: post.opened_at.toISOString(),
        closeTime: post.closed_at ? post.closed_at.toISOString() : null,
        duration: post.duration || 'Live',
        strategyId: post.strategy_id,
        comment: post.custom_description
      },
      strategy: {
        id: post.strategy_id,
        name: post.strategy_name || post.strategy_id.toUpperCase(),
        tagline: 'High Probability Setup'
      },
      autoDescription: post.auto_description,
      customDescription: post.custom_description,
      isUnlocked,
      unlockFee: post.unlock_price ?? 1,
      followFee: post.follow_price ?? 1,
      likesCount: post.likes_count,
      commentsCount: post.comments_count,
      followersCount: post.followers_count ?? (post.followed_by_user_ids?.length || 0),
      isLiked,
      isSaved,
      isFollowed,
      isFollowingSetup,
      createdAt: post.created_at.toISOString()
    };
  }
}

export const feedService = new FeedService();
