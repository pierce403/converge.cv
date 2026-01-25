import { useCallback, useEffect, useMemo, useState } from 'react';
import { IdentifierKind, type Identifier, type InboxState, type Installation } from '@xmtp/browser-sdk';
import { useAuthStore, useConversationStore } from '@/lib/stores';
import { getXmtpClient, type GroupKeySummary } from '@/lib/xmtp';

interface KeyExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type KeyExplorerIcon =
  | 'inbox'
  | 'folder'
  | 'identity'
  | 'installation'
  | 'conversation'
  | 'group'
  | 'dm'
  | 'shield'
  | 'key'
  | 'lock'
  | 'clock'
  | 'history';

interface NodeDetail {
  label: string;
  value: string;
  masked?: boolean;
  copyValue?: string;
  monospaced?: boolean;
}

interface KeyExplorerNode {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  icon: KeyExplorerIcon;
  when?: string;
  badge?: string;
  details?: NodeDetail[];
  children?: KeyExplorerNode[];
}

interface ConversationKeyContext {
  summary: GroupKeySummary | null;
}

const ICON_PATHS: Record<KeyExplorerIcon, string> = {
  inbox: 'M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm3 0h12v1.382a2 2 0 0 1-.895 1.664l-4.21 2.806a2 2 0 0 1-2.21 0L5.895 9.046A2 2 0 0 1 5 7.382z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  identity: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 7a7 7 0 0 1 14 0z',
  installation: 'M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm6 12a1 1 0 1 1-1 1 1 1 0 0 1 1-1zm-4-9h8a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2z',
  conversation: 'M4 5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4V5z',
  group: 'M12 7a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm-7 9a5 5 0 0 1 10 0zm12-5a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm0 2a6.978 6.978 0 0 1 4 1.236V19l-3.5-2.625A4.992 4.992 0 0 0 17 13zm-12-5a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm0 2a4.992 4.992 0 0 0-1.5.375L2 13v4l3.5-2.625A6.978 6.978 0 0 1 5 13z',
  dm: 'M4 4h16v12H7l-3 3z',
  shield: 'M12 2 5 5v6c0 5 3.8 9.4 7 11 3.2-1.6 7-6 7-11V5z',
  key: 'M21 2a7 7 0 0 0-12.32 4.15L2 12v4h4l1.17-1.17A3 3 0 1 0 11 12.17l2.12-2.12A7 7 0 0 0 21 2zm-5 5a2 2 0 1 1 2-2 2 2 0 0 1-2 2z',
  lock: 'M6 10V7a6 6 0 0 1 12 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1zm2 0h8V7a4 4 0 0 0-8 0z',
  clock: 'M12 2a10 10 0 1 1-10 10A10 10 0 0 1 12 2zm1 5h-2v6l5 3 .99-1.71-3.99-2.29z',
  history: 'M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-2.05-4.95L15 10h7V3l-2.24 2.24A8.962 8.962 0 0 0 13 3z',
};

function Icon({ type }: { type: KeyExplorerIcon }) {
  return (
    <svg className="h-5 w-5 text-primary-200" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={ICON_PATHS[type]} />
    </svg>
  );
}

function Chevron({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-primary-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M6 6l6 4-6 4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 12) return value;
  const head = value.slice(0, 6);
  const tail = value.slice(-4);
  return `${head}…${tail}`;
}

function shortId(value: string): string {
  if (!value) return '';
  const clean = value.trim();
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function nanosToLocaleString(value?: bigint | number | null): string | undefined {
  if (typeof value === 'bigint') {
    const ms = Number(value / 1_000_000n);
    return new Date(ms).toLocaleString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toLocaleString();
  }
  return undefined;
}

function toDigestBuffer(bytes: Uint8Array): ArrayBuffer {
  const underlying = bytes.buffer as ArrayBuffer;
  if (bytes.byteOffset === 0 && bytes.byteLength === underlying.byteLength) {
    return underlying;
  }
  return underlying.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0) return '';
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', toDigestBuffer(bytes));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback to FNV-1a 32-bit hash when SubtleCrypto is unavailable (e.g., non-browser tests)
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (hex.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      return new Uint8Array();
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

function formatFingerprint(value: string): string {
  if (!value) return 'Unavailable';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function normalizeIdentifier(identifier: Identifier): string {
  const raw = String(identifier?.identifier ?? '');
  if (!raw) return '';
  if (identifier?.identifierKind === IdentifierKind.Ethereum) {
    return raw.startsWith('0x') ? raw : `0x${raw}`;
  }
  return raw;
}

function getInstallationBytes(installation: Installation): Uint8Array | null {
  if (installation?.bytes instanceof Uint8Array) {
    return installation.bytes;
  }
  const maybe = (installation as unknown as { installationId?: Uint8Array; idBytes?: Uint8Array }).installationId;
  if (maybe instanceof Uint8Array) return maybe;
  const fallback = (installation as unknown as { idBytes?: Uint8Array }).idBytes;
  if (fallback instanceof Uint8Array) return fallback;
  return null;
}

function isNativeRuntime(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.product === 'ReactNative';
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (!value) return;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } else {
        // Fallback to prompt copy when clipboard API is unavailable
        if (typeof window !== 'undefined') {
          window.prompt('Copy value', value);
        }
      }
    } catch (error) {
      console.warn('[KeyExplorer] Failed to copy value', error);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded border border-primary-700/70 px-2 py-0.5 text-[11px] text-primary-100 transition hover:border-primary-500"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function DetailRow({ detail }: { detail: NodeDetail }) {
  const [revealed, setRevealed] = useState(false);
  const displayValue = detail.masked && !revealed ? maskValue(detail.value) : detail.value;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-primary-300">
      <span className="uppercase tracking-wide text-primary-400">{detail.label}</span>
      <span className={`${detail.monospaced ? 'font-mono text-[11px]' : ''} text-primary-100`}>{displayValue}</span>
      {detail.masked && (
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          className="rounded border border-primary-800 px-2 py-0.5 text-[10px] text-primary-200 transition hover:border-primary-600"
        >
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      )}
      {detail.copyValue && <CopyButton value={detail.copyValue} />}
    </div>
  );
}

function TreeNode({
  node,
  level,
  expandedState,
  onToggle,
}: {
  node: KeyExplorerNode;
  level: number;
  expandedState: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isOpen = expandedState[node.id] ?? false;

  return (
    <li>
      <div className="flex items-start gap-2" style={{ paddingLeft: `${level * 16}px` }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="mt-1 flex h-6 w-6 items-center justify-center rounded hover:bg-primary-900/70"
            aria-label={isOpen ? 'Collapse section' : 'Expand section'}
          >
            <Chevron isOpen={isOpen} />
          </button>
        ) : (
          <span className="mt-1 h-6 w-6" />
        )}
        <div className="flex flex-1 gap-3 rounded-lg border border-primary-900/60 bg-primary-950/40 p-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-primary-900/60">
            <Icon type={node.icon} />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary-100">
              <span>{node.title}</span>
              {node.subtitle && <span className="text-xs font-normal text-primary-300">{node.subtitle}</span>}
              {node.badge && (
                <span className="rounded-full border border-accent-500/60 bg-accent-900/30 px-2 py-0.5 text-[10px] font-medium text-accent-200">
                  {node.badge}
                </span>
              )}
            </div>
            {node.when && <div className="text-[10px] uppercase tracking-wide text-primary-400">{node.when}</div>}
            {node.description && <p className="text-xs text-primary-200">{node.description}</p>}
            {node.details?.map((detail) => (
              <DetailRow key={`${node.id}-${detail.label}`} detail={detail} />
            ))}
          </div>
        </div>
      </div>
      {hasChildren && isOpen && (
        <ul className="mt-2 space-y-2">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expandedState={expandedState}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function KeyExplorerModal({ isOpen, onClose }: KeyExplorerModalProps) {
  const identity = useAuthStore((state) => state.identity);
  const conversations = useConversationStore((state) => state.conversations);
  const [tree, setTree] = useState<KeyExplorerNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const xmtp = getXmtpClient();
        let inboxState: InboxState | null = null;
        try {
          inboxState = await xmtp.getInboxState();
        } catch (err) {
          console.warn('[KeyExplorer] Failed to load inbox state', err);
        }

        const inboxId = inboxState?.inboxId || identity?.inboxId || '';
        const installationId = xmtp.getInstallationId();

        const installationFingerprints = new Map<string, string>();
        const installations = inboxState?.installations ?? [];
        await Promise.all(
          installations.map(async (installation) => {
            const bytes = getInstallationBytes(installation);
            if (!bytes) return;
            const fp = await fingerprintBytes(bytes);
            installationFingerprints.set(installation.id ?? '', fp);
          }),
        );

        const identityFingerprint = identity?.publicKey
          ? await fingerprintBytes(hexToBytes(identity.publicKey))
          : '';
        const localHpkeFingerprint = installationId
          ? installationFingerprints.get(installationId) ?? ''
          : '';

        const groupContexts: Record<string, ConversationKeyContext> = {};
        await Promise.all(
          conversations
            .filter((conversation) => conversation.isGroup)
            .map(async (conversation) => {
              try {
                const summary = await xmtp.getGroupKeySummary(conversation.id);
                groupContexts[conversation.id] = { summary };
              } catch (err) {
                console.warn('[KeyExplorer] Failed to load group key summary', conversation.id, err);
                groupContexts[conversation.id] = { summary: null };
              }
            }),
        );

        const identityNodes: KeyExplorerNode[] = [];
        const seenIdentifiers = new Set<string>();
        (inboxState?.accountIdentifiers ?? []).forEach((identifier, index) => {
          const normalized = normalizeIdentifier(identifier);
          const kindLabel = IdentifierKind[identifier.identifierKind] ?? 'Identifier';
          const short = shortId(normalized);
          let title = `${kindLabel} ${short}`;
          let description = 'Linked identity for this inbox.';
          if (identifier.identifierKind === IdentifierKind.Ethereum) {
            title = `EOA ${short}`;
            description = 'Signs identity actions for this inbox.';
          } else if (identifier.identifierKind === IdentifierKind.Passkey) {
            title = `Passkey ${short}`;
            description = 'Passkey credential bound to this inbox.';
          }

          const node: KeyExplorerNode = {
            id: `identity-${index}-${normalized}`,
            title,
            icon: 'identity',
            description,
            details: [
              {
                label: 'Identifier',
                value: normalized || 'Unavailable',
                masked: Boolean(normalized),
                copyValue: normalized || undefined,
                monospaced: true,
              },
            ],
          };

          if (identity?.address && normalized && normalized.toLowerCase() === identity.address.toLowerCase()) {
            node.when = identity.createdAt ? `Created ${new Date(identity.createdAt).toLocaleString()}` : undefined;
          }

          identityNodes.push(node);
          if (normalized) seenIdentifiers.add(normalized.toLowerCase());
        });

        if (identity?.address && !seenIdentifiers.has(identity.address.toLowerCase())) {
          identityNodes.push({
            id: `identity-active-${identity.address}`,
            title: `EOA ${shortId(identity.address)}`,
            icon: 'identity',
            description: 'Active wallet for this session.',
            when: identity.createdAt ? `Created ${new Date(identity.createdAt).toLocaleString()}` : undefined,
            details: [
              {
                label: 'Identifier',
                value: identity.address,
                masked: true,
                copyValue: identity.address,
                monospaced: true,
              },
            ],
          });
        }

        const installationNodes: KeyExplorerNode[] = (installations ?? []).map((installation, index) => {
          const installId = installation.id ?? `installation-${index}`;
          const short = shortId(installId);
          const fingerprint = installationFingerprints.get(installId) ?? '';
          const when = nanosToLocaleString(installation.clientTimestampNs ?? null);
          return {
            id: `installation-${installId}`,
            title: `Install ${short}`,
            icon: 'installation',
            description: 'Device/app keypair used by this app install.',
            badge: installationId && installId === installationId ? 'This device' : undefined,
            when: when ? `First seen ${when}` : undefined,
            details: [
              {
                label: 'Installation ID',
                value: installId,
                masked: true,
                copyValue: installId,
                monospaced: true,
              },
              {
                label: 'Fingerprint (SHA-256)',
                value: formatFingerprint(fingerprint),
                copyValue: fingerprint || undefined,
                monospaced: true,
              },
            ],
          } satisfies KeyExplorerNode;
        });

        const groupNodes: KeyExplorerNode[] = conversations
          .filter((conversation) => conversation.isGroup)
          .map((conversation) => {
            const summary = groupContexts[conversation.id]?.summary ?? null;
            const conversationShort = shortId(conversation.id);
            const credentialFp = identityFingerprint;
            const hpkeFp = localHpkeFingerprint;
            const epochLabel = summary?.currentEpoch !== undefined && summary?.currentEpoch !== null
              ? `current: #${summary.currentEpoch}`
              : 'current: unknown';
            const epochRange = summary?.epochRange
              ? `#${summary.epochRange.min}–#${summary.epochRange.max}`
              : 'Unknown';

            const mlsChildren: KeyExplorerNode[] = [
              {
                id: `group-${conversation.id}-credential`,
                title: 'Credential (signature) key',
                subtitle: credentialFp ? `pub: ${formatFingerprint(credentialFp)}` : 'pub: unavailable',
                icon: 'key',
                description: 'Authenticates member commits & messages in this group.',
                details: credentialFp
                  ? [
                      {
                        label: 'Fingerprint (SHA-256)',
                        value: formatFingerprint(credentialFp),
                        copyValue: credentialFp,
                        monospaced: true,
                      },
                    ]
                  : [
                      {
                        label: 'Fingerprint',
                        value: 'Not available (wallet-managed identity)',
                      },
                    ],
              },
              {
                id: `group-${conversation.id}-hpke`,
                title: 'HPKE init key',
                subtitle: hpkeFp ? `pub: ${formatFingerprint(hpkeFp)}` : 'pub: unavailable',
                icon: 'shield',
                description: 'Used to encrypt MLS handshake material to this member.',
                details: hpkeFp
                  ? [
                      {
                        label: 'Fingerprint (SHA-256)',
                        value: formatFingerprint(hpkeFp),
                        copyValue: hpkeFp,
                        monospaced: true,
                      },
                    ]
                  : [
                      {
                        label: 'Fingerprint',
                        value: 'Not available (installation key unknown)',
                      },
                    ],
              },
              {
                id: `group-${conversation.id}-epoch`,
                title: 'Epoch secrets',
                subtitle: epochLabel,
                icon: 'clock',
                description: 'Derives message keys for the current epoch on this device.',
                details:
                  summary?.forkDetails || summary?.maybeForked
                    ? [
                        {
                          label: 'Status',
                          value: summary?.maybeForked ? 'Forked – investigate sync' : 'Healthy',
                        },
                        summary?.forkDetails
                          ? {
                              label: 'Details',
                              value: summary.forkDetails,
                            }
                          : undefined,
                      ].filter(Boolean) as NodeDetail[]
                    : undefined,
              },
              {
                id: `group-${conversation.id}-epochs-held`,
                title: 'Past epochs held',
                subtitle: epochRange,
                icon: 'history',
                description: 'You can decrypt messages in these epochs on this device.',
              },
            ];

            return {
              id: `group-${conversation.id}`,
              title: `Group: “${conversation.groupName || conversation.displayName || 'Untitled'}”`,
              subtitle: `conv-${conversationShort}`,
              icon: 'group',
              description: 'MLS group conversation in your inbox.',
              details: [
                {
                  label: 'Conversation ID',
                  value: conversation.id,
                  masked: true,
                  copyValue: conversation.id,
                  monospaced: true,
                },
              ],
              children: [
                {
                  id: `group-${conversation.id}-mls`,
                  title: 'MLS Keys',
                  icon: 'folder',
                  description: 'Group encryption material derived for this inbox.',
                  children: mlsChildren,
                },
              ],
            } satisfies KeyExplorerNode;
          });

        const dmNodes: KeyExplorerNode[] = conversations
          .filter((conversation) => !conversation.isGroup)
          .map((conversation) => {
            const labelTarget = conversation.displayName || conversation.peerId || conversation.id;
            const shortTarget = shortId(labelTarget ?? '');
            const conversationShort = shortId(conversation.id);
            return {
              id: `dm-${conversation.id}`,
              title: `DM: with ${shortTarget}`,
              subtitle: `conv-${conversationShort}`,
              icon: 'dm',
              description: 'Direct message channel with rotating session keys.',
              details: [
                {
                  label: 'Conversation ID',
                  value: conversation.id,
                  masked: true,
                  copyValue: conversation.id,
                  monospaced: true,
                },
              ],
              children: [
                {
                  id: `dm-${conversation.id}-session-keys`,
                  title: 'Session keys (rotating)',
                  icon: 'lock',
                  description: 'Per-peer message protection (non-MLS).',
                },
              ],
            } satisfies KeyExplorerNode;
          });

        const inboxNodes: KeyExplorerNode[] = [];
        const inboxDisplayValue = inboxId || identity?.address || '';
        inboxNodes.push({
          id: 'inbox-root',
          title: inboxDisplayValue ? `Inbox ${shortId(inboxDisplayValue)}` : 'Inbox (not registered)',
          icon: 'inbox',
          description: inboxDisplayValue
            ? 'Primary XMTP inbox registered for this identity.'
            : 'No registered inbox detected for the active identity.',
          details: [
            {
              label: 'Inbox ID',
              value: inboxDisplayValue || 'Not registered',
              masked: Boolean(inboxDisplayValue),
              copyValue: inboxDisplayValue || undefined,
              monospaced: Boolean(inboxDisplayValue),
            },
          ],
          children: [
            {
              id: 'inbox-identities',
              title: 'Identities',
              icon: 'folder',
              description: 'Linked signers that can act on behalf of this inbox.',
              children: identityNodes,
            },
            {
              id: 'inbox-installations',
              title: 'Installations',
              icon: 'folder',
              description: 'Registered devices and app installations.',
              children: installationNodes,
            },
          ],
        });

        const conversationRoot: KeyExplorerNode | null = conversations.length
          ? {
              id: 'conversations-root',
              title: 'Conversations',
              icon: 'conversation',
              description: 'Active DM and group threads known to this client.',
              children: [...groupNodes, ...dmNodes],
            }
          : null;

        const builtTree = conversationRoot ? [...inboxNodes, conversationRoot] : inboxNodes;

        if (!cancelled) {
          setTree(builtTree);
          setHasLoadedOnce(true);

          const nextExpanded: Record<string, boolean> = {};
          const markExpanded = (node: KeyExplorerNode, depth = 0) => {
            if (depth < 2) {
              nextExpanded[node.id] = true;
            }
            node.children?.forEach((child) => markExpanded(child, depth + 1));
          };
          builtTree.forEach((node) => markExpanded(node));
          setExpanded((prev) => ({ ...nextExpanded, ...prev }));
        }
      } catch (err) {
        console.error('[KeyExplorer] Failed to build key explorer data', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load key explorer data.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [conversations, identity, isOpen]);

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);


  const webBanner = useMemo(() => {
    if (isNativeRuntime()) return null;
    return (
      <div className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        Browser DB is not encrypted.
      </div>
    );
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-2xl border border-primary-800/70 bg-primary-950/95 p-6 text-primary-50 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-primary-300 transition hover:bg-primary-900/70"
          aria-label="Close key explorer"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M6 6l12 12M6 18L18 6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <header className="space-y-2 pr-10">
          <h2 className="text-2xl font-bold">Key Explorer</h2>
          <p className="text-sm text-primary-200">
            Read-only view of inbox identities, installations, and MLS key material available on this device. Key material is
            not removable from here.
          </p>
          {webBanner}
        </header>
        {error && (
          <div className="rounded-lg border border-red-500/60 bg-red-900/30 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
        {loading && hasLoadedOnce && (
          <div className="rounded-lg border border-primary-800/70 bg-primary-900/30 px-3 py-2 text-xs text-primary-200">
            Refreshing key data…
          </div>
        )}
        {!hasLoadedOnce && loading ? (
          <div className="flex flex-1 items-center justify-center py-10 text-sm text-primary-300">Loading key data…</div>
        ) : tree.length ? (
          <ul className="space-y-3 pb-6">
            {tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                level={0}
                expandedState={expanded}
                onToggle={handleToggle}
              />
            ))}
          </ul>
        ) : (
          <div className="py-8 text-center text-sm text-primary-300">
            No key data available. Connect to XMTP to populate this view.
          </div>
        )}
      </div>
    </div>
  );
}
