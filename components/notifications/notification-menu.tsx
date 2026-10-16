'use client';

import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, usePaginatedQuery, useMutation, useConvexAuth } from 'convex/react';
import { Bell, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';
import { Button } from '@/components/ui/button';
import {
  MARK_ALL_READ_MAX_BATCHES,
  markAllReadBatchLimitExceeded,
} from '@/components/notifications/notification-menu-policy';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

type NotificationItemData = FunctionReturnType<typeof api.notifications.listMine>['page'][number];

class NotificationMenuErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="flex items-center gap-2 text-sm">
          <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
          <span>Could not load notifications.</span>
          <Button variant="ghost" size="sm" onClick={this.props.onRetry}>
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

function NotificationItem({ notification }: { notification: NotificationItemData }) {
  const markRead = useMutation(api.notifications.markRead);
  const [isMarking, setIsMarking] = useState(false);
  const [error, setError] = useState(false);

  const handleMarkRead = async () => {
    setIsMarking(true);
    setError(false);
    try {
      await markRead({ notificationId: notification._id });
    } catch {
      setError(true);
    } finally {
      setIsMarking(false);
    }
  };

  const isRead = !!notification.readAt;

  return (
    <li className={`flex flex-col gap-1 p-3 text-sm border-b last:border-0 ${isRead ? 'opacity-60' : ''}`}>
      <p>{notification.message}</p>
      {notification.reason && <p className="text-xs text-muted-foreground">{notification.reason}</p>}
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-muted-foreground">
          {new Date(notification.createdAt).toLocaleDateString()}
        </span>
        {!isRead && (
          <DropdownMenuItem
            className="ml-auto h-6 px-2 py-1 text-xs"
            onSelect={(event) => {
              event.preventDefault();
              void handleMarkRead();
            }}
            disabled={isMarking}
          >
            Mark read
          </DropdownMenuItem>
        )}
        {error && (
            <span role="alert" title="Could not mark as read">
                <AlertCircle className="size-4 text-destructive" />
            </span>
        )}
      </div>
    </li>
  );
}

function NotificationList({ 
    notifications, 
    status, 
    loadMore 
}: { 
    notifications: NotificationItemData[], 
    status: string, 
    loadMore: (num: number) => void 
}) {
    return (
        <ul className="flex flex-col">
            {notifications.map((n) => (
            <NotificationItem key={n._id} notification={n} />
            ))}
            {status === 'LoadingMore' && (
            <li className="flex justify-center p-2"><Loader2 className="animate-spin size-4" /></li>
            )}
            {status === 'CanLoadMore' && (
            <li className="p-2">
                <DropdownMenuItem
                  className="w-full justify-center text-xs"
                  onSelect={(event) => {
                    event.preventDefault();
                    loadMore(10);
                  }}
                >
                Load more
                </DropdownMenuItem>
            </li>
            )}
        </ul>
    );
}

function NotificationToolbar({
    displayCount,
    isMarkingAll,
    onMarkAllRead,
    markAllError,
    markedCount
}: {
    displayCount: number;
    isMarkingAll: boolean;
    onMarkAllRead: () => void;
    markAllError: boolean;
    markedCount: number;
}) {
    return (
        <div className="border-b p-2 flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between">
            <span>Notifications</span>
            <DropdownMenuItem
                className="h-6 px-2 py-1 text-xs"
                disabled={displayCount === 0 || isMarkingAll}
                onSelect={(event) => {
                  event.preventDefault();
                  onMarkAllRead();
                }}
            >
                Mark all read
            </DropdownMenuItem>
          </div>
          {(markAllError || markedCount > 0) && (
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                    {markedCount} marked read {markAllError ? '— could not finish' : ''}
                </span>
                {markAllError && (
                    <DropdownMenuItem
                      className="h-6 px-2 py-1 text-xs text-destructive"
                      onSelect={(event) => {
                        event.preventDefault();
                        onMarkAllRead();
                      }}
                    >
                        Retry
                    </DropdownMenuItem>
                )}
            </div>
          )}
        </div>
    );
}

export function NotificationMenu() {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <NotificationMenuErrorBoundary
      key={retryKey}
      onRetry={() => setRetryKey((current) => current + 1)}
    >
      <NotificationMenuContent />
    </NotificationMenuErrorBoundary>
  );
}

function NotificationMenuContent() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const unreadCount = useQuery(
    api.notifications.unreadCount,
    isAuthenticated ? {} : 'skip'
  );
  
  const {
    results: notifications,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.notifications.listMine,
    isAuthenticated ? {} : 'skip',
    { initialNumItems: 10 }
  );

  const markAllRead = useMutation(api.notifications.markAllReadBatch);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState(false);
  const [markedCount, setMarkedCount] = useState(0);

  const handleMarkAllRead = async () => {
    setIsMarkingAll(true);
    setMarkAllError(false);
    setMarkedCount(0);
    let currentTotal = 0;
    try {
      let hasMore = true;
      let iterations = 0;
      while (hasMore && iterations < MARK_ALL_READ_MAX_BATCHES) {
        const result = await markAllRead({});
        currentTotal += result.updatedCount;
        setMarkedCount(currentTotal);
        hasMore = result.hasMore;
        iterations++;
      }
      if (markAllReadBatchLimitExceeded(hasMore, iterations)) {
        throw new Error('Too many batches');
      }
    } catch {
      setMarkAllError(true);
    } finally {
      setIsMarkingAll(false);
    }
  };

  const displayCount = unreadCount ?? 0;
  const countLabel = displayCount > 99 ? '99+' : displayCount.toString();

  const renderContent = () => {
    if (authLoading) return <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div>;
    if (!isAuthenticated) return <div className="p-4 text-sm text-center">Please sign in.</div>;
    if (status === 'LoadingFirstPage') return <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div>;
    if (notifications.length === 0) return <div className="p-4 text-sm text-center text-muted-foreground">No notifications</div>;
    
    return <NotificationList notifications={notifications} status={status} loadMore={loadMore} />;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-5" />
          {displayCount > 0 && (
            <Badge className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full p-0 text-xs">
              {countLabel}
            </Badge>
          )}
          <span className="sr-only">Notifications ({displayCount} unread)</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="w-[min(20rem,calc(100vw-2rem))]"
      >
        <NotificationToolbar 
            displayCount={displayCount}
            isMarkingAll={isMarkingAll}
            onMarkAllRead={handleMarkAllRead}
            markAllError={markAllError}
            markedCount={markedCount}
        />
        <div className="max-h-[70vh] overflow-y-auto">
            {renderContent()}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
