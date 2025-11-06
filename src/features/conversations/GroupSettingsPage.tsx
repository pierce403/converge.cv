import { useState, useEffect, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore, useContactStore } from '@/lib/stores';
import { useConversations } from '@/features/conversations/useConversations';
import { getAddress } from 'viem';
import type { GroupMember } from '@/types';
import { isDisplayableImageSrc } from '@/lib/utils/image';
import type { Contact } from '@/lib/stores/contact-store';
import { PermissionPolicy, PermissionUpdateType, GroupPermissionsOptions } from '@xmtp/browser-sdk';

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const isEthereumAddress = (value: string) => ETH_ADDRESS_REGEX.test(value.trim());

const safeNormalizeAddress = (value: string) => {
  try {
    return getAddress(value.trim() as `0x${string}`);
  } catch {
    return value.trim();
  }
};

const JOIN_POLICY_OPTIONS: Array<{
  value: PermissionPolicy;
  label: string;
  description: string;
  shareNote: string;
}> = [
  {
    value: PermissionPolicy.Allow,
    label: 'Open join (anyone with the link)',
    description:
      'All members can invite new people, and anyone with the join link can add themselves instantly.',
    shareNote: 'Anyone who receives this link can join right away.',
  },
  {
    value: PermissionPolicy.Admin,
    label: 'Admin approval required',
    description: 'Only group admins can add new members. Share links let admins know who wants to join.',
    shareNote: 'People who open this link will still need an admin to add them.',
  },
  {
    value: PermissionPolicy.SuperAdmin,
    label: 'Super admins only',
    description: 'Only super admins can approve or add new members to the group.',
    shareNote: 'Only super admins can add someone after they open this link.',
  },
  {
    value: PermissionPolicy.Deny,
    label: 'Closed group',
    description: 'No new members can be added until you change this setting.',
    shareNote: 'Join links are disabled while the group is closed.',
  },
];

const GROUP_POLICY_TYPE_LABELS: Record<
  GroupPermissionsOptions,
  { label: string; description: string }
> = {
  [GroupPermissionsOptions.Default]: {
    label: 'Default policy',
    description: 'Members can invite new people, while admins manage removals and metadata.',
  },
  [GroupPermissionsOptions.AdminOnly]: {
    label: 'Admin-only policy',
    description: 'Only admins can add or remove members or change group details.',
  },
  [GroupPermissionsOptions.CustomPolicy]: {
    label: 'Custom policy',
    description: 'Permissions have been customized individually via the XMTP API.',
  },
};

export function GroupSettingsPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const {
    conversations,
    updateGroupMetadata,
    updateGroupPermission,
    addMembersToGroup,
    removeMembersFromGroup,
    promoteMemberToAdmin,
    demoteAdminToMember,
    refreshGroupDetails,
  } = useConversations();
  const { identity } = useAuthStore();
  const contacts = useContactStore((state) => state.contacts);
  const loadContacts = useContactStore((state) => state.loadContacts);
  const contactsLoading = useContactStore((state) => state.isLoading);

  const conversation = conversations.find((c) => c.id === conversationId);
  const [groupName, setGroupName] = useState(conversation?.groupName || '');
  const [groupImage, setGroupImage] = useState(conversation?.groupImage || '');
  const [groupDescription, setGroupDescription] = useState(conversation?.groupDescription || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [newMemberAddress, setNewMemberAddress] = useState('');
  const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);
  const [contactSearchTerm, setContactSearchTerm] = useState('');
  const [selectedContactInboxIds, setSelectedContactInboxIds] = useState<string[]>([]);
  const [isAddingContacts, setIsAddingContacts] = useState(false);
  const [joinPolicySelection, setJoinPolicySelection] = useState<string>('loading');
  const [joinPolicyValue, setJoinPolicyValue] = useState<PermissionPolicy | null>(null);
  const [initialJoinPolicyValue, setInitialJoinPolicyValue] = useState<PermissionPolicy | null>(null);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const contactsByAddress = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const contact of contacts) {
      if (contact.primaryAddress) {
        map.set(contact.primaryAddress.toLowerCase(), contact);
      }
      contact.addresses?.forEach((address) => {
        map.set(address.toLowerCase(), contact);
      });
    }
    return map;
  }, [contacts]);

  const contactsByInboxId = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const contact of contacts) {
      map.set(contact.inboxId.toLowerCase(), contact);
    }
    return map;
  }, [contacts]);

  const adminInboxSet = useMemo(() => {
    if (!conversation) {
      return new Set<string>();
    }
    return new Set((conversation.adminInboxes ?? []).map((value) => value.toLowerCase()));
  }, [conversation]);

  const adminAddressSet = useMemo(() => {
    if (!conversation) {
      return new Set<string>();
    }
    return new Set((conversation.admins ?? []).map((value) => value.toLowerCase()));
  }, [conversation]);

  const superAdminInboxSet = useMemo(() => {
    if (!conversation) {
      return new Set<string>();
    }
    return new Set((conversation.superAdminInboxes ?? []).map((value) => value.toLowerCase()));
  }, [conversation]);

  const selectedJoinPolicyOption = useMemo(
    () => JOIN_POLICY_OPTIONS.find((option) => option.value.toString() === joinPolicySelection),
    [joinPolicySelection],
  );

  const policyTypeSummary = useMemo(() => {
    const type = conversation?.groupPermissions?.policyType;
    if (type === undefined) {
      return null;
    }
    return GROUP_POLICY_TYPE_LABELS[type as GroupPermissionsOptions] ?? null;
  }, [conversation?.groupPermissions?.policyType]);

  const joinPolicyShareNote = useMemo(() => {
    if (joinPolicySelection === 'loading') {
      return 'Copy the link once the current access mode finishes loading.';
    }
    if (joinPolicySelection === 'custom') {
      return 'This group uses a custom XMTP permission set. Joining behavior may vary until you choose a standard mode.';
    }
    if (selectedJoinPolicyOption) {
      return `Copy and share this link to invite people. ${selectedJoinPolicyOption.shareNote}`;
    }
    return 'Copy and share this link to invite people to the group.';
  }, [joinPolicySelection, selectedJoinPolicyOption]);

  const memberEntries = useMemo<GroupMember[]>(() => {
    if (!conversation?.isGroup) {
      return [];
    }

    const enrichMember = (member: GroupMember): GroupMember => {
      const inboxLower = member.inboxId.toLowerCase();
      const normalizedAddress = member.address && isEthereumAddress(member.address)
        ? safeNormalizeAddress(member.address)
        : member.address;
      const addressLower = normalizedAddress?.toLowerCase();

      const contactByAddress = addressLower ? contactsByAddress.get(addressLower) : undefined;
      const contactByInbox = contactsByInboxId.get(inboxLower);
      const contact = contactByAddress ?? contactByInbox;

      const resolvedAddress = normalizedAddress ?? contact?.primaryAddress;
      const displayName = member.displayName
        ?? contact?.preferredName
        ?? contact?.name
        ?? resolvedAddress
        ?? member.inboxId;
      const avatar = member.avatar ?? contact?.avatar;

      const isAdmin = (member.isAdmin ?? false)
        || adminInboxSet.has(inboxLower)
        || (resolvedAddress ? adminAddressSet.has(resolvedAddress.toLowerCase()) : false);
      const isSuperAdmin = (member.isSuperAdmin ?? false) || superAdminInboxSet.has(inboxLower);

      return {
        ...member,
        inboxId: member.inboxId,
        address: resolvedAddress,
        displayName,
        avatar,
        isAdmin,
        isSuperAdmin,
      };
    };

    if (conversation.groupMembers && conversation.groupMembers.length > 0) {
      return conversation.groupMembers.map(enrichMember);
    }

    const fallbackAddresses = conversation.members ?? [];
    const fallbackInboxes = conversation.memberInboxes ?? [];
    const maxLength = Math.max(fallbackAddresses.length, fallbackInboxes.length);

    const members: GroupMember[] = [];
    for (let index = 0; index < maxLength; index++) {
      const rawInbox = fallbackInboxes[index] ?? fallbackAddresses[index] ?? '';
      const rawAddress = fallbackAddresses[index];
      const normalizedAddress =
        rawAddress && isEthereumAddress(rawAddress) ? safeNormalizeAddress(rawAddress) : rawAddress;
      const inboxId = rawInbox || normalizedAddress || '';
      if (!inboxId) {
        continue;
      }

      const baseMember: GroupMember = {
        inboxId,
        address: normalizedAddress,
      };
      members.push(enrichMember(baseMember));
    }

    return members;
  }, [conversation, contactsByAddress, contactsByInboxId, adminInboxSet, adminAddressSet, superAdminInboxSet]);

  const isCurrentUserAdmin = useMemo(() => {
    if (!conversation?.isGroup || !identity) {
      return false;
    }

    const identityAddress = identity.address?.toLowerCase();
    const identityInbox = identity.inboxId?.toLowerCase();

    if (identityAddress && adminAddressSet.has(identityAddress)) {
      return true;
    }

    if (identityInbox && adminInboxSet.has(identityInbox)) {
      return true;
    }

    const currentMember = memberEntries.find((member) => {
      const matchesAddress = identityAddress && member.address?.toLowerCase() === identityAddress;
      const matchesInbox = identityInbox && member.inboxId.toLowerCase() === identityInbox;
      return Boolean(matchesAddress || matchesInbox);
    });

    if (!currentMember) {
      return false;
    }

    if (currentMember.isSuperAdmin || currentMember.isAdmin) {
      return true;
    }

    if (typeof currentMember.permissionLevel === 'number' && currentMember.permissionLevel >= 1) {
      return true;
    }

    return false;
  }, [conversation, identity, memberEntries, adminAddressSet, adminInboxSet]);

  const normalizedNewMemberAddress = useMemo(() => {
    const value = newMemberAddress.trim();
    if (!value) {
      return null;
    }
    if (!isEthereumAddress(value)) {
      return null;
    }
    return safeNormalizeAddress(value);
  }, [newMemberAddress]);

  const existingMemberIdentifiers = useMemo(() => {
    const identifiers = new Set<string>();
    for (const member of memberEntries) {
      identifiers.add(member.inboxId.toLowerCase());
      if (member.address) {
        identifiers.add(member.address.toLowerCase());
      }
    }
    return identifiers;
  }, [memberEntries]);

  const availableContacts = useMemo(() => {
    const currentIdentityAddress = identity?.address?.toLowerCase();
    return contacts.filter((contact) => {
      const primaryLower = contact.primaryAddress?.toLowerCase();
      if (currentIdentityAddress && primaryLower && primaryLower === currentIdentityAddress) {
        return false;
      }
      if (contact.inboxId && existingMemberIdentifiers.has(contact.inboxId.toLowerCase())) {
        return false;
      }
      if (primaryLower && existingMemberIdentifiers.has(primaryLower)) {
        return false;
      }
      const anyAddressAlreadyMember = contact.addresses
        ?.map((addr) => addr.toLowerCase())
        .some((addr) => existingMemberIdentifiers.has(addr));
      return !anyAddressAlreadyMember;
    });
  }, [contacts, existingMemberIdentifiers, identity?.address]);

  const filteredContacts = useMemo(() => {
    if (!contactSearchTerm.trim()) {
      return availableContacts;
    }
    const query = contactSearchTerm.trim().toLowerCase();
    return availableContacts.filter((contact) => {
      const preferred = contact.preferredName?.toLowerCase() ?? '';
      const name = contact.name?.toLowerCase() ?? '';
      const primary = contact.primaryAddress?.toLowerCase() ?? '';
      const addresses = contact.addresses?.map((addr) => addr.toLowerCase()) ?? [];
      return (
        preferred.includes(query) ||
        name.includes(query) ||
        primary.includes(query) ||
        addresses.some((addr) => addr.includes(query))
      );
    });
  }, [availableContacts, contactSearchTerm]);

  const toggleContactSelection = (inboxId: string) => {
    setSelectedContactInboxIds((prev) => {
      const normalized = inboxId.toLowerCase();
      const has = prev.some((entry) => entry.toLowerCase() === normalized);
      if (has) {
        return prev.filter((entry) => entry.toLowerCase() !== normalized);
      }
      return [...prev, inboxId];
    });
  };

  const resetContactSelectionState = () => {
    setSelectedContactInboxIds([]);
    setContactSearchTerm('');
  };

  const handleCloseContactPicker = () => {
    if (isAddingContacts) {
      return;
    }
    setIsContactPickerOpen(false);
    resetContactSelectionState();
  };

  const handleConfirmContactSelection = async () => {
    if (selectedContactInboxIds.length === 0) {
      return;
    }

    if (!conversation) {
      setError('Group conversation not available.');
      return;
    }

    setIsAddingContacts(true);
    setError('');
    try {
      const payload = selectedContactInboxIds.map((inboxId) => {
        const normalized = inboxId.toLowerCase();
        const contact = contactsByInboxId.get(normalized);
        const address = contact?.primaryAddress ?? contact?.addresses?.[0];
        if (address && isEthereumAddress(address)) {
          return safeNormalizeAddress(address);
        }
        return inboxId;
      });
      const uniqueMembers = Array.from(new Set(payload));
      const selectionCount = uniqueMembers.length;
      await addMembersToGroup(conversation.id, uniqueMembers);
      resetContactSelectionState();
      setIsContactPickerOpen(false);
      alert(selectionCount === 1 ? 'Member added!' : 'Members added!');
    } catch (err) {
      console.error('Failed to add selected contacts:', err);
      setError('Failed to add selected contacts. Please try again.');
    } finally {
      setIsAddingContacts(false);
    }
  };

  useEffect(() => {
    if (conversation?.id && conversation.isGroup) {
      refreshGroupDetails(conversation.id).catch((err) => {
        console.warn('Failed to refresh group details on settings load:', err);
      });
    }
  }, [conversation?.id, conversation?.isGroup, refreshGroupDetails]);

  useEffect(() => {
    if (conversation) {
      setGroupName(conversation.groupName || '');
      setGroupImage(conversation.groupImage || '');
      setGroupDescription(conversation.groupDescription || '');
    }
  }, [conversation]);

  useEffect(() => {
    const policy = conversation?.groupPermissions?.policySet?.addMemberPolicy;
    if (policy === undefined) {
      setJoinPolicySelection('loading');
      setJoinPolicyValue(null);
      setInitialJoinPolicyValue(null);
      return;
    }
    if (policy === PermissionPolicy.Other || policy === PermissionPolicy.DoesNotExist) {
      setJoinPolicySelection('custom');
      setJoinPolicyValue(null);
      setInitialJoinPolicyValue(null);
      return;
    }
    const typedPolicy = policy as PermissionPolicy;
    setJoinPolicySelection(typedPolicy.toString());
    setJoinPolicyValue(typedPolicy);
    setInitialJoinPolicyValue(typedPolicy);
  }, [conversation?.groupPermissions?.policySet?.addMemberPolicy]);

  if (!conversation || !conversation.isGroup) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-primary-50">
        <p>Group conversation not found or is not a group.</p>
        <button onClick={() => navigate(-1)} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  const handleJoinPolicyChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setJoinPolicySelection(value);
    if (value === 'custom' || value === 'loading') {
      setJoinPolicyValue(null);
      return;
    }
    const numericValue = Number(value) as PermissionPolicy;
    setJoinPolicyValue(numericValue);
  };

  const handleSave = async () => {
    if (!conversation) {
      setError('Group conversation could not be loaded.');
      return;
    }

    if (!isCurrentUserAdmin) {
      setError('Only group admins can update settings.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const metadataPayload = {
        groupName: groupName || undefined,
        groupImage: groupImage || undefined,
        groupDescription: groupDescription || undefined,
      };
      const metadataChanged =
        (groupName || '') !== (conversation.groupName || '') ||
        (groupImage || '') !== (conversation.groupImage || '') ||
        (groupDescription || '') !== (conversation.groupDescription || '');

      const operations: Array<Promise<unknown>> = [];

      if (metadataChanged) {
        operations.push(updateGroupMetadata(conversation.id, metadataPayload));
      }

      const permissionChanged =
        joinPolicyValue !== null && joinPolicyValue !== initialJoinPolicyValue;
      if (permissionChanged && joinPolicyValue !== null) {
        operations.push(
          updateGroupPermission(
            conversation.id,
            PermissionUpdateType.AddMember,
            joinPolicyValue,
          ),
        );
      }

      if (operations.length === 0) {
        setIsSaving(false);
        alert('No changes to save.');
        return;
      }

      await Promise.all(operations);

      if (permissionChanged && joinPolicyValue !== null) {
        setInitialJoinPolicyValue(joinPolicyValue);
      }

      alert('Group settings saved!');
      navigate(-1);
    } catch (err) {
      console.error('Failed to save group settings:', err);
      setError('Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddMember = async () => {
    setError('');

    if (!normalizedNewMemberAddress) {
      setError('Enter a valid Ethereum address (0x…) before adding.');
      return;
    }

    if (existingMemberIdentifiers.has(normalizedNewMemberAddress.toLowerCase())) {
      setError('This member is already part of the group.');
      return;
    }

    if (!isCurrentUserAdmin) {
      setError('Only group admins can add members.');
      return;
    }

    try {
      await addMembersToGroup(conversation.id, [normalizedNewMemberAddress]);
      setNewMemberAddress('');
      alert('Member added!');
    } catch (err) {
      console.error('Failed to add member:', err);
      setError('Failed to add member. Please try again.');
    }
  };

  const handleRemoveMember = async (member: GroupMember) => {
    setError('');

    if (!isCurrentUserAdmin) {
      setError('Only group admins can remove members.');
      return;
    }
    const label = member.address ?? member.inboxId;
    if (window.confirm(`Are you sure you want to remove ${label}?`)) {
      try {
        await removeMembersFromGroup(conversation.id, [member.inboxId]);
        alert('Member removed!');
      } catch (err) {
        console.error('Failed to remove member:', err);
        setError('Failed to remove member. Please try again.');
      }
    }
  };

  const handlePromoteToAdmin = async (member: GroupMember) => {
    setError('');

    if (!isCurrentUserAdmin) {
      setError('Only group admins can promote members.');
      return;
    }
    try {
      await promoteMemberToAdmin(conversation.id, member.inboxId);
      alert('Member promoted to admin!');
    } catch (err) {
      console.error('Failed to promote member:', err);
      setError('Failed to promote member. Please try again.');
    }
  };

  const handleDemoteFromAdmin = async (member: GroupMember) => {
    setError('');

    if (!isCurrentUserAdmin) {
      setError('Only group admins can demote admins.');
      return;
    }
    const label = member.address ?? member.inboxId;
    if (window.confirm(`Are you sure you want to demote ${label}?`)) {
      try {
        await demoteAdminToMember(conversation.id, member.inboxId);
        alert('Admin demoted to member!');
      } catch (err) {
        console.error('Failed to demote admin:', err);
        setError('Failed to demote admin. Please try again.');
      }
    }
  };

  const getContactForMember = (member: GroupMember): Contact | undefined => {
    if (member.address) {
      const match = contactsByAddress.get(member.address.toLowerCase());
      if (match) {
        return match;
      }
    }
    return contactsByInboxId.get(member.inboxId.toLowerCase());
  };

  const getMemberDisplayName = (member: GroupMember) => {
    if (member.displayName) {
      return member.displayName;
    }
    const contact = getContactForMember(member);
    if (contact?.preferredName) {
      return contact.preferredName;
    }
    if (contact?.name) {
      return contact.name;
    }
    if (member.address) {
      return `${member.address.slice(0, 6)}...${member.address.slice(-4)}`;
    }
    return `${member.inboxId.slice(0, 6)}...${member.inboxId.slice(-4)}`;
  };

  const getMemberAvatar = (member: GroupMember) => {
    if (member.avatar) {
      return member.avatar;
    }
    const contact = getContactForMember(member);
    return contact?.avatar;
  };

  const formatIdentifier = (value: string) => {
    if (!value) {
      return '';
    }
    if (value.startsWith('0x') && value.length > 10) {
      return `${value.slice(0, 6)}...${value.slice(-4)}`;
    }
    if (value.length > 18) {
      return `${value.slice(0, 8)}...${value.slice(-4)}`;
    }
    return value;
  };

  const getContactDisplayName = (contact: Contact) => contact.preferredName || contact.name;

  const renderContactAvatar = (avatar: string | undefined, fallback: string) => {
    if (isDisplayableImageSrc(avatar)) {
      return <img src={avatar} alt="Contact avatar" className="w-full h-full rounded-full object-cover" />;
    }
    if (avatar) {
      return <span className="text-lg" aria-hidden>{avatar}</span>;
    }
    return <span className="text-white font-semibold" aria-hidden>{fallback.slice(0, 2).toUpperCase()}</span>;
  };

  return (
    <div className="flex flex-col h-full text-primary-50">
      <header className="bg-primary-950/80 border-b border-primary-800/60 px-4 py-3 flex items-center gap-3 backdrop-blur-md shadow-lg">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-primary-200 hover:text-primary-50 hover:bg-primary-900/50 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold">Group Settings</h1>
        <button
          onClick={handleSave}
          className="btn-primary text-sm px-3 py-1 ml-auto"
          disabled={isSaving || !isCurrentUserAdmin}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 bg-primary-950/30">
        <div className="max-w-md mx-auto space-y-6">
          {error && (
            <div className="bg-red-900/20 border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Group Name */}
          <div>
            <label htmlFor="groupName" className="block text-sm font-medium mb-2">
              Group Name
            </label>
            <input
              id="groupName"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Enter group name"
              className="input-primary w-full"
              disabled={!isCurrentUserAdmin}
            />
          </div>
          {isCurrentUserAdmin && isContactPickerOpen && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-primary-950/80 backdrop-blur-sm">
              <div className="bg-primary-900/95 border border-primary-700 rounded-2xl shadow-2xl w-full max-w-md mx-4">
                <div className="flex items-center justify-between px-4 py-3 border-b border-primary-700/60">
                  <h3 className="text-lg font-semibold text-primary-50">Add members from contacts</h3>
                  <button
                    className="text-primary-300 hover:text-primary-50"
                    onClick={handleCloseContactPicker}
                    aria-label="Close contact picker"
                  >
                    ✕
                  </button>
                </div>
                <div className="px-4 py-3 flex flex-col gap-3">
                  <input
                    type="text"
                    value={contactSearchTerm}
                    onChange={(event) => setContactSearchTerm(event.target.value)}
                    placeholder="Search contacts..."
                    className="input-primary w-full"
                  />
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-primary-800/60 bg-primary-950/50">
                    {contactsLoading && availableContacts.length === 0 ? (
                      <div className="py-6 text-center text-primary-300 text-sm">Loading contacts…</div>
                    ) : filteredContacts.length === 0 ? (
                      <div className="py-6 text-center text-primary-300 text-sm">No contacts available.</div>
                    ) : (
                      <ul className="divide-y divide-primary-900/60">
                        {filteredContacts.map((contact) => {
                          const normalizedInboxId = contact.inboxId.toLowerCase();
                          const isSelected = selectedContactInboxIds.some(
                            (entry) => entry.toLowerCase() === normalizedInboxId
                          );
                          const avatarContent = renderContactAvatar(
                            contact.preferredAvatar ?? contact.avatar,
                            contact.primaryAddress ?? contact.addresses?.[0] ?? contact.inboxId
                          );
                          return (
                            <li key={contact.inboxId}>
                              <button
                                type="button"
                                onClick={() => toggleContactSelection(contact.inboxId)}
                                className={`flex items-center gap-3 w-full text-left px-3 py-2 transition-colors ${
                                  isSelected ? 'bg-primary-800/60 border-l-2 border-accent-500' : 'hover:bg-primary-800/40'
                                }`}
                              >
                                <div className="w-10 h-10 rounded-full bg-primary-700/80 flex items-center justify-center overflow-hidden">
                                  {avatarContent}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-primary-50 font-semibold truncate">{getContactDisplayName(contact)}</p>
                                  {contact.preferredName && contact.preferredName !== contact.name && (
                                    <p className="text-xs text-primary-400 truncate">{contact.name}</p>
                                  )}
                                  <p className="text-xs text-primary-300 truncate">{formatIdentifier(contact.primaryAddress ?? contact.addresses?.[0] ?? contact.inboxId)}</p>
                                </div>
                                <div className="w-5 h-5 flex items-center justify-center">
                                  {isSelected && (
                                    <span className="text-accent-400" aria-hidden>✓</span>
                                  )}
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm text-primary-200">
                    <span>{selectedContactInboxIds.length} selected</span>
                    <div className="flex gap-2">
                      <button
                        className="btn-secondary"
                        onClick={handleCloseContactPicker}
                        disabled={isAddingContacts}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn-primary"
                        onClick={handleConfirmContactSelection}
                        disabled={selectedContactInboxIds.length === 0 || isAddingContacts}
                      >
                        {isAddingContacts ? 'Adding…' : 'Add selected'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Group Image */}
          <div>
            <label htmlFor="groupImage" className="block text-sm font-medium mb-2">
              Group Image URL
            </label>
            <input
              id="groupImage"
              type="text"
              value={groupImage}
              onChange={(e) => setGroupImage(e.target.value)}
              placeholder="https://example.com/group-avatar.png"
              className="input-primary w-full"
              disabled={!isCurrentUserAdmin}
            />
            {groupImage && (
              <div className="mt-2">
                <img src={groupImage} alt="Group Avatar" className="w-24 h-24 rounded-full object-cover" />
              </div>
            )}
          </div>

          {/* Group Description */}
          <div>
            <label htmlFor="groupDescription" className="block text-sm font-medium mb-2">
              Group Description
            </label>
            <textarea
              id="groupDescription"
              value={groupDescription}
              onChange={(e) => setGroupDescription(e.target.value)}
              placeholder="A brief description of the group..."
              className="input-primary w-full h-24 resize-none"
              disabled={!isCurrentUserAdmin}
            />
          </div>

          {/* Access Control */}
          <div>
            <h2 className="text-lg font-semibold mb-2">Access Control</h2>
            <label htmlFor="groupAccessMode" className="block text-sm font-medium mb-2">
              Who can add new members?
            </label>
            <select
              id="groupAccessMode"
              className="input-primary w-full"
              value={joinPolicySelection}
              onChange={handleJoinPolicyChange}
              disabled={!isCurrentUserAdmin || joinPolicySelection === 'loading'}
            >
              {joinPolicySelection === 'loading' && (
                <option value="loading" disabled>
                  Loading current permissions…
                </option>
              )}
              {joinPolicySelection === 'custom' && (
                <option value="custom" disabled>
                  Custom XMTP policy (advanced)
                </option>
              )}
              {JOIN_POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="mt-2 text-sm text-primary-200 space-y-1">
              {joinPolicySelection === 'loading' ? (
                <p>Loading the latest access controls…</p>
              ) : joinPolicySelection === 'custom' ? (
                <p>
                  This group is using a custom XMTP permission set. Selecting a mode above will replace it with one of
                  the standard options.
                </p>
              ) : selectedJoinPolicyOption ? (
                <p>{selectedJoinPolicyOption.description}</p>
              ) : null}
              {policyTypeSummary && (
                <p className="text-xs text-primary-400">
                  Base policy:{' '}
                  <span className="font-medium text-primary-200">{policyTypeSummary.label}</span> —{' '}
                  {policyTypeSummary.description}
                </p>
              )}
            </div>
          </div>

          {/* Member Management */}
          <div>
            <h2 className="text-lg font-semibold mb-2">Member Management</h2>
            {isCurrentUserAdmin && (
              <div className="flex flex-col gap-2 mb-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMemberAddress}
                    onChange={(e) => {
                      setNewMemberAddress(e.target.value);
                      if (error) {
                        setError('');
                      }
                    }}
                    placeholder="Add member address (0x...)"
                    className="input-primary flex-1"
                  />
                  <button
                    className="btn-primary"
                    onClick={handleAddMember}
                    disabled={
                      !normalizedNewMemberAddress ||
                      existingMemberIdentifiers.has(normalizedNewMemberAddress.toLowerCase())
                    }
                  >
                    Add
                  </button>
                </div>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setError('');
                    setIsContactPickerOpen(true);
                  }}
                  disabled={contactsLoading && availableContacts.length === 0}
                >
                  Select from contacts
                </button>
              </div>
            )}
            <ul className="bg-primary-900/70 rounded-lg p-3 space-y-2">
              {memberEntries.map((member) => {
                const isSelf =
                  (identity?.address && member.address?.toLowerCase() === identity.address.toLowerCase()) ||
                  (identity?.inboxId && member.inboxId.toLowerCase() === identity.inboxId.toLowerCase());
                const avatar = getMemberAvatar(member);
                const fallbackLabel = member.address ?? member.inboxId;
                const avatarContent = avatar
                  ? isDisplayableImageSrc(avatar)
                    ? <img src={avatar} alt="Member avatar" className="w-full h-full rounded-full object-cover" />
                    : <span className="text-lg" aria-hidden>{avatar}</span>
                  : <span className="text-white font-semibold" aria-hidden>{fallbackLabel.slice(0, 2).toUpperCase()}</span>;
                const secondaryLine = member.address ?? member.inboxId;

                return (
                  <li key={member.inboxId} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-primary-800/50 transition-colors">
                    <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-700 flex items-center justify-center text-sm font-semibold overflow-hidden">
                      {avatarContent}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-primary-50">{getMemberDisplayName(member)}</span>
                      <span className="text-xs text-primary-400">{formatIdentifier(secondaryLine)}</span>
                    </div>
                    {member.isSuperAdmin ? (
                      <span className="text-accent-300 text-xs px-2 py-0.5 bg-accent-900 rounded-full">Super Admin</span>
                    ) : member.isAdmin ? (
                      <span className="text-accent-300 text-xs px-2 py-0.5 bg-accent-900 rounded-full">Admin</span>
                    ) : null}
                  </div>
                  {isCurrentUserAdmin && (
                    <div className="flex gap-2">
                      {!member.isAdmin && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => handlePromoteToAdmin(member)}
                        >
                          Promote
                        </button>
                      )}
                      {member.isAdmin && !isSelf && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => handleDemoteFromAdmin(member)}
                        >
                          Demote
                        </button>
                      )}
                      {!isSelf && (
                        <button
                          className="btn-danger btn-xs"
                          onClick={() => handleRemoveMember(member)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          </div>

          {/* Share Group Link */}
          <div>
            <h2 className="text-lg font-semibold mb-2">Share Group Link</h2>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}/join-group/${conversation.id}`}
                className="input-primary flex-1 cursor-text"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                className="btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/join-group/${conversation.id}`);
                  alert('Link copied to clipboard!');
                }}
              >
                Copy
              </button>
            </div>
            <p className="text-primary-300 text-sm mt-2">
              {joinPolicyShareNote}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
