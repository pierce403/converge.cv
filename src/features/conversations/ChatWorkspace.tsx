import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChatList } from './ChatList';
import { ConversationView } from '@/features/messages';

const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

function useIsDesktopLayout() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(media.matches);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  return isDesktop;
}

export function ChatWorkspace() {
  const { id } = useParams<{ id: string }>();
  const isDesktop = useIsDesktopLayout();

  if (!isDesktop) {
    return id ? <ConversationView /> : <ChatList />;
  }

  return (
    <div className="h-full overflow-hidden lg:grid lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="hidden h-full min-h-0 border-r border-primary-800/60 bg-primary-950/40 lg:flex lg:flex-col">
        <ChatList />
      </aside>
      <section className="h-full min-h-0">
        {id ? (
          <ConversationView showBackButton={false} />
        ) : (
          <div className="hidden h-full items-center justify-center bg-primary-950/20 text-primary-200 lg:flex">
            <div className="max-w-sm px-6 text-center">
              <h2 className="text-lg font-semibold text-primary-50">Select a conversation</h2>
              <p className="mt-2 text-sm text-primary-300">Choose a chat from the left to start messaging.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
