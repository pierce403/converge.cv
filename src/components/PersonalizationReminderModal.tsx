import type { ReactNode, ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import { useAuthStore } from '@/lib/stores/auth-store';
import { getStorage } from '@/lib/storage';
import { getXmtpClient } from '@/lib/xmtp';

interface PersonalizationReminderModalProps {
  missingDisplayName: boolean;
  missingAvatar: boolean;
  onRemindLater: () => void;
  onDismissForever: () => void;
}

const bulletCopy: Record<'displayName' | 'avatar', ReactNode> = {
  displayName: (
    <span>
      Add a <span className="font-semibold text-primary-100">display name</span> so friends know it&apos;s you.
    </span>
  ),
  avatar: (
    <span>
      Upload an <span className="font-semibold text-primary-100">avatar</span> to stand out in conversations.
    </span>
  ),
};

export function PersonalizationReminderModal({
  missingDisplayName,
  missingAvatar,
  onRemindLater,
  onDismissForever,
}: PersonalizationReminderModalProps) {
  const identity = useAuthStore((s) => s.identity);
  const setIdentity = useAuthStore((s) => s.setIdentity);
  // Suggested name: Color + Animal when no display name is set
  const suggestedName = useMemo(() => {
    if (identity?.displayName?.trim()) return identity.displayName.trim();
    const colors = [
      'Red',
      'Blue',
      'Green',
      'Yellow',
      'Purple',
      'Orange',
      'Pink',
      'Brown',
      'Black',
      'White',
    ];
    const animals = [
      'Orca', 'Dolphin', 'Whale', 'Penguin', 'Seal', 'Otter', 'Shark', 'Turtle', 'Eagle', 'Falcon',
      'Hawk', 'Owl', 'Fox', 'Wolf', 'Bear', 'Tiger', 'Lion', 'Zebra', 'Giraffe', 'Elephant',
      'Monkey', 'Panda', 'Koala', 'Kangaroo', 'Rabbit', 'Deer', 'Horse', 'Bison', 'Buffalo', 'Camel',
      'Hippo', 'Rhino', 'Leopard', 'Cheetah', 'Jaguar', 'Goat', 'Sheep', 'Cow', 'Pig', 'Dog',
      'Cat', 'Goose', 'Duck', 'Swan', 'Frog', 'Toad', 'Lizard', 'Snake', 'Chimpanzee', 'Gorilla',
    ];
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    return `${pick(colors)} ${pick(animals)}`;
  }, [identity?.displayName]);

  const [displayName, setDisplayName] = useState<string>(suggestedName);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(identity?.avatar || undefined);
  const [isSaving, setIsSaving] = useState(false);

  const onPickAvatar = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024) {
      alert('Avatar image must be less than 256KB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUri = String(ev.target?.result || '');
      setAvatarDataUrl(dataUri);
    };
    reader.onerror = () => alert('Failed to read image file');
    reader.readAsDataURL(file);
  };

  const onSave = async () => {
    try {
      setIsSaving(true);
      const storage = await getStorage();
      const current = identity;
      if (!current) {
        alert('No identity found. Please connect first.');
        return;
      }
      const updated = { ...current, displayName: displayName.trim() || current.displayName, avatar: avatarDataUrl || current.avatar };
      await storage.putIdentity(updated);
      setIdentity(updated);
      try {
        const xmtp = getXmtpClient();
        await xmtp.saveProfile(updated.displayName, updated.avatar);
      } catch (e) {
        console.warn('[Personalization] Failed to save profile to XMTP (non-fatal):', e);
      }
      // Close and snooze reminder
      onRemindLater();
    } catch (e) {
      console.error('[Personalization] Failed to save profile:', e);
      alert('Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onRemindLater}>
      <div
        className="relative w-full max-w-sm rounded-2xl border border-primary-800/60 bg-primary-950/95 p-6 text-primary-100 shadow-2xl backdrop-blur"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="personalization-reminder-title"
      >
        <button
          onClick={onRemindLater}
          className="absolute right-4 top-4 rounded-full p-1 text-primary-300 transition-colors hover:bg-primary-900/60 hover:text-primary-100"
          aria-label="Remind me later"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex flex-col gap-4">
          <div>
            <h2 id="personalization-reminder-title" className="text-xl font-semibold text-white">
              Make it yours
            </h2>
            <p className="mt-1 text-sm text-primary-200">
              Personalize your profile so people can recognize you instantly.
            </p>
          </div>

          <ul className="space-y-2 text-sm text-primary-200">
            {missingDisplayName && (
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-accent-400" aria-hidden="true" />
                {bulletCopy.displayName}
              </li>
            )}
            {missingAvatar && (
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-accent-400" aria-hidden="true" />
                {bulletCopy.avatar}
              </li>
            )}
          </ul>

          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-primary-300">Avatar</label>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary-800/70 overflow-hidden flex items-center justify-center">
                  {avatarDataUrl ? (
                    <img src={avatarDataUrl} alt="Avatar preview" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-primary-300">None</span>
                  )}
                </div>
                <label className="btn-secondary cursor-pointer">
                  <input type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
                  Upload
                </label>
                {avatarDataUrl && (
                  <button className="btn-secondary" onClick={() => setAvatarDataUrl(undefined)}>
                    Clear
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-primary-400">Max 256KB. Image is stored in your XMTP profile for discovery.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-primary-300">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="input-primary w-full"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button onClick={onSave} className="btn-primary w-full" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={onRemindLater} className="btn-secondary w-full">
              Remind me tomorrow
            </button>
            <button
              onClick={onDismissForever}
              className="text-sm font-medium text-primary-300 underline-offset-2 transition-colors hover:text-primary-100 hover:underline"
            >
              Don&apos;t remind me again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
