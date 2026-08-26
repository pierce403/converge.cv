import { Fragment } from 'react';
import { Menu, Portal, Transition } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/stores';
import { sanitizeImageSrc } from '@/lib/utils/image';

const shortId = (value?: string): string => {
  const id = value?.trim();
  if (!id) return 'Identity unavailable';
  if (id.length <= 18) return id;
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
};

/**
 * Compact menu for the one active identity. Legacy inbox registry data stays
 * intact for recovery, but routine navigation no longer switches, creates, or
 * imports additional inboxes from the authenticated header.
 */
export function InboxSwitcher() {
  const navigate = useNavigate();
  const identity = useAuthStore((state) => state.identity);
  const label = identity?.displayName?.trim() || 'Converge';
  const avatar = sanitizeImageSrc(identity?.avatar);
  const initials = label.slice(0, 2).toUpperCase();

  const copyInboxId = async () => {
    if (!identity?.inboxId) return;
    try {
      await navigator.clipboard.writeText(identity.inboxId);
      window.dispatchEvent(new CustomEvent('ui:toast', { detail: 'Inbox ID copied' }));
    } catch (error) {
      console.warn('[IdentityMenu] Could not copy inbox ID:', error);
      window.dispatchEvent(new CustomEvent('ui:toast', { detail: 'Could not copy inbox ID' }));
    }
  };

  return (
    <Menu as="div" className="relative z-[12000] inline-block text-left">
      <Menu.Button
        aria-label={`Open profile menu for ${label}`}
        className="flex max-w-[15rem] items-center gap-2 rounded-full border border-primary-700/70 bg-primary-900/80 px-2 py-1.5 text-left text-sm font-medium text-primary-100 shadow transition hover:border-accent-400 hover:text-white"
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-600 text-sm font-semibold text-white">
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : initials}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-xs text-primary-400">Profile</span>
          <span className="block truncate text-sm font-semibold text-primary-100">{label}</span>
        </span>
        <svg className="h-4 w-4 shrink-0 text-primary-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="scale-95 opacity-0"
        enterTo="scale-100 opacity-100"
        leave="transition ease-in duration-75"
        leaveFrom="scale-100 opacity-100"
        leaveTo="scale-95 opacity-0"
      >
        <Portal>
          <Menu.Items className="fixed left-3 top-16 z-[20000] w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-primary-800/80 bg-primary-950/95 p-3 text-primary-100 shadow-2xl backdrop-blur focus:outline-none">
            <div className="px-2 pb-3">
              <div className="truncate font-semibold">{label}</div>
              <div className="mt-1 truncate font-mono text-xs text-primary-400">
                {shortId(identity?.inboxId)}
              </div>
            </div>
            <div className="h-px bg-primary-800/70" />
            <Menu.Item>
              {({ active }) => (
                <button type="button" onClick={() => navigate('/settings')} className={`mt-2 w-full rounded-md px-3 py-2 text-left text-sm ${active ? 'bg-primary-800/80 text-white' : 'text-primary-200'}`}>
                  Profile & settings
                </button>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <button type="button" onClick={() => navigate('/contacts')} className={`w-full rounded-md px-3 py-2 text-left text-sm ${active ? 'bg-primary-800/80 text-white' : 'text-primary-200'}`}>
                  Contacts
                </button>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <button type="button" onClick={() => void copyInboxId()} disabled={!identity?.inboxId} className={`w-full rounded-md px-3 py-2 text-left text-sm disabled:opacity-50 ${active ? 'bg-primary-800/80 text-white' : 'text-primary-300'}`}>
                  Copy inbox ID
                </button>
              )}
            </Menu.Item>
          </Menu.Items>
        </Portal>
      </Transition>
    </Menu>
  );
}
