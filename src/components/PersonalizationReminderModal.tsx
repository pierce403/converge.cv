import type { ReactNode } from 'react';

interface PersonalizationReminderModalProps {
  missingDisplayName: boolean;
  missingAvatar: boolean;
  onRemindLater: () => void;
  onDismissForever: () => void;
  onGoToSettings: () => void;
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
  onGoToSettings,
}: PersonalizationReminderModalProps) {
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

          <div className="flex flex-col gap-2">
            <button onClick={onGoToSettings} className="btn-primary w-full">
              Update profile
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
