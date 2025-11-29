import { useState } from 'react';
import { useFarcasterStore } from '@/lib/stores/farcaster-store';
import { useAuthStore } from '@/lib/stores';
import { getStorage } from '@/lib/storage';

export function FarcasterSettings() {
  const filters = useFarcasterStore((state) => state.filters);
  const setFilters = useFarcasterStore((state) => state.setFilters);
  const userKey = useFarcasterStore((state) => state.userNeynarApiKey);
  const defaultKey = useFarcasterStore((state) => state.defaultNeynarApiKey);
  const setUserKey = useFarcasterStore((state) => state.setUserNeynarApiKey);
  const clearUserKey = useFarcasterStore((state) => state.clearUserNeynarApiKey);
  const getEffectiveKey = useFarcasterStore((state) => state.getEffectiveNeynarApiKey);
  const effectiveKey = getEffectiveKey();

  const identity = useAuthStore((state) => state.identity);
  const setIdentity = useAuthStore((state) => state.setIdentity);

  const [localKey, setLocalKey] = useState(userKey ?? '');
  const [localFid, setLocalFid] = useState(identity?.farcasterFid ? String(identity.farcasterFid) : '');
  const [message, setMessage] = useState<string | null>(null);

  const saveFid = async () => {
    setMessage(null);
    if (!identity) {
      setMessage('Connect an identity before linking Farcaster.');
      return;
    }
    if (!localFid.trim()) {
      setMessage('Enter your Farcaster FID to use sync and filters.');
      return;
    }
    const parsed = Number(localFid.trim());
    if (Number.isNaN(parsed)) {
      setMessage('FID must be a number.');
      return;
    }
    try {
      const storage = await getStorage();
      const updatedIdentity = { ...identity, farcasterFid: parsed };
      await storage.putIdentity(updatedIdentity);
      setIdentity(updatedIdentity);
      setMessage('Saved Farcaster FID for contact sync.');
    } catch (error) {
      console.warn('[Settings] Failed to save Farcaster FID', error);
      setMessage('Could not save Farcaster FID.');
    }
  };

  const saveKey = () => {
    setUserKey(localKey || undefined);
    setMessage('Updated Neynar API key.');
  };

  const removeKey = () => {
    clearUserKey();
    setLocalKey('');
    setMessage('Removed personal Neynar API key.');
  };

  const handleNumberChange = (field: 'minScore' | 'minFollowerCount' | 'minFollowingCount', value: string) => {
    const parsed = value === '' ? null : Number(value);
    setFilters({ [field]: Number.isNaN(parsed as number) ? null : (parsed as number | null) });
  };

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Farcaster & Neynar</h2>
      <div className="bg-primary-900/60 border border-primary-800/60 rounded-lg divide-y divide-primary-800/60 backdrop-blur">
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-primary-100">Neynar API key</p>
              <p className="text-sm text-primary-300">
                {effectiveKey ? 'Using a configured Neynar key for Farcaster lookups.' : 'Add a key to enable Farcaster sync.'}
              </p>
            </div>
            {defaultKey && !userKey && (
              <span className="text-xs px-2 py-1 rounded bg-primary-800/60 text-primary-200 border border-primary-700/60">
                Default key detected
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              type="password"
              value={localKey}
              placeholder={defaultKey ? 'Using default key – add your own to override' : 'Enter Neynar API key'}
              onChange={(e) => setLocalKey(e.target.value)}
              className="input-primary"
            />
            <div className="flex gap-2">
              <button onClick={saveKey} className="btn-primary text-sm px-3 py-2">Save Key</button>
              <button onClick={removeKey} className="btn-secondary text-sm px-3 py-2">Use Default/Remove</button>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-primary-100">Your Farcaster account</p>
              <p className="text-sm text-primary-300">Stores your FID for syncing followed users into contacts.</p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              className="input-primary flex-1"
              value={localFid}
              onChange={(e) => setLocalFid(e.target.value)}
              placeholder="Enter your Farcaster FID"
            />
            <button onClick={saveFid} className="btn-secondary px-3 py-2 text-sm">Save FID</button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <p className="font-medium text-primary-100">Message filters</p>
            <p className="text-sm text-primary-300">
              Incoming messages from Farcaster contacts can be hidden unless they meet these thresholds.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-primary-200 mb-1">Minimum Neynar score</label>
              <input
                type="number"
                min={0}
                className="input-primary w-full"
                value={filters.minScore ?? ''}
                onChange={(e) => handleNumberChange('minScore', e.target.value)}
                placeholder="e.g. 50"
              />
            </div>
            <div>
              <label className="block text-sm text-primary-200 mb-1">Minimum followers</label>
              <input
                type="number"
                min={0}
                className="input-primary w-full"
                value={filters.minFollowerCount ?? ''}
                onChange={(e) => handleNumberChange('minFollowerCount', e.target.value)}
                placeholder="e.g. 100"
              />
            </div>
            <div>
              <label className="block text-sm text-primary-200 mb-1">Minimum following</label>
              <input
                type="number"
                min={0}
                className="input-primary w-full"
                value={filters.minFollowingCount ?? ''}
                onChange={(e) => handleNumberChange('minFollowingCount', e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm text-primary-200">
              <input
                type="checkbox"
                className="form-checkbox text-accent-500 rounded"
                checked={filters.requireActiveStatus ?? false}
                onChange={(e) => setFilters({ requireActiveStatus: e.target.checked })}
              />
              Active profiles only
            </label>
            <label className="flex items-center gap-2 text-sm text-primary-200">
              <input
                type="checkbox"
                className="form-checkbox text-accent-500 rounded"
                checked={filters.requirePowerBadge ?? false}
                onChange={(e) => setFilters({ requirePowerBadge: e.target.checked })}
              />
              Require power badge
            </label>
            <label className="flex items-center gap-2 text-sm text-primary-200">
              <input
                type="checkbox"
                className="form-checkbox text-accent-500 rounded"
                checked={filters.requireFarcasterIdentity ?? false}
                onChange={(e) => setFilters({ requireFarcasterIdentity: e.target.checked })}
              />
              Only if Farcaster-linked
            </label>
          </div>
          <p className="text-xs text-primary-400">
            Filters can also be toggled per conversation. Messages that do not meet the criteria will be hidden from the inbox.
          </p>
        </div>
        {message && <div className="p-4 text-xs text-primary-100 bg-primary-800/60">{message}</div>}
      </div>
    </section>
  );
}
