import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore, useContactStore } from '@/lib/stores';
import { useConversations } from '@/features/conversations/useConversations';
import { getAddress } from 'viem';
import type { GroupMember } from '@/types';
import { sanitizeImageSrc } from '@/lib/utils/image';
import type { Contact } from '@/lib/stores/contact-store';
import {
  PermissionPolicy,
  PermissionUpdateType,
  GroupPermissionsOptions,
  PermissionLevel,
} from '@xmtp/browser-sdk';

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
}> = [
  {
    value: PermissionPolicy.Allow,
    label: 'Members can add new members',
    description:
      'Any existing group member can add someone to the group. Ask a member or admin to invite the new person directly from Converge.',
  },
  {
    value: PermissionPolicy.Admin,
    label: 'Admins can add new members',
    description: 'Only group admins can add or approve new members. Contact an admin when someone needs to join.',
  },
  {
    value: PermissionPolicy.SuperAdmin,
    label: 'Super admins only',
    description: 'Only super admins can add or approve new members to the group.',
  },
  {
    value: PermissionPolicy.Deny,
    label: 'Closed group',
    description: 'No new members can be added until you change this setting.',
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
    deleteGroup,
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

  // Group avatar helpers — mirror user avatar flow: accept a file and turn it into a base64 data URL
  const MAX_AVATAR_DATA_URL_BYTES = 256 * 1024; // user-profile parity
  const MAX_GROUP_IMAGE_CHARS = 2048; // protocol limit for group metadata field length

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });

  const downscaleDataUrlIfNeeded = async (dataUrl: string, byteCap = MAX_AVATAR_DATA_URL_BYTES): Promise<string> => {
    try {
      if (!dataUrl || dataUrl.length <= byteCap) return dataUrl;
      // Draw into canvas and downscale to fit within 512x512; adjust quality if still large
      const img = new Image();
      const loaded: Promise<void> = new Promise((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('Failed to load image'));
      });
      img.src = dataUrl;
      await loaded;
      const maxDim = 512;
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(img.width * ratio));
      canvas.height = Math.max(1, Math.floor(img.height * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Try a couple of qualities to get under the cap
      const qualities = [0.8, 0.7, 0.6, 0.5];
      for (const q of qualities) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= byteCap) return out;
      }
      // If still large, return the last attempt
      return canvas.toDataURL('image/jpeg', 0.5);
    } catch {
      return dataUrl;
    }
  };

  const onGroupImageFileSelected = async (file?: File | null) => {
    try {
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      // First, downscale to user-profile cap (helps with huge images)
      let sized = await downscaleDataUrlIfNeeded(dataUrl, MAX_AVATAR_DATA_URL_BYTES);
      // Then, if still over the protocol's group metadata limit (character count), aggressively reduce
      if (sized.length > MAX_GROUP_IMAGE_CHARS) {
        // Iteratively shrink canvas max dimension and quality until we fit or give up
        const img = new Image();
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error('Failed to load image'));
          img.src = sized;
        });
        let dim = 128; // start small for group meta
        let finalOut = sized;
        while (dim >= 32 && finalOut.length > MAX_GROUP_IMAGE_CHARS) {
          const canvas = document.createElement('canvas');
          const ratio = Math.min(1, dim / Math.max(img.width, img.height));
          canvas.width = Math.max(1, Math.floor(img.width * ratio));
          canvas.height = Math.max(1, Math.floor(img.height * ratio));
          const ctx2 = canvas.getContext('2d');
          if (!ctx2) break;
          ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
          for (const q of [0.5, 0.4, 0.3, 0.25]) {
            const out = canvas.toDataURL('image/jpeg', q);
            if (out.length <= MAX_GROUP_IMAGE_CHARS) {
              finalOut = out;
              break;
            }
            finalOut = out;
          }
          dim = Math.floor(dim / 2);
        }
        if (finalOut.length > MAX_GROUP_IMAGE_CHARS) {
          setError('Avatar too large for group metadata field. Please use a smaller image or paste a hosted URL (<2048 chars).');
        }
        sized = finalOut;
      }
      setGroupImage(sized);
    } catch (e) {
      console.warn('[GroupSettings] Failed to process avatar image:', e);
      alert('Failed to process image. Please try a different file.');
    }
  };
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

  const identityAddressLower = identity?.address?.toLowerCase();
  const identityInboxLower = identity?.inboxId?.toLowerCase();

  const currentMember = useMemo(() => {
    if (!identityAddressLower && !identityInboxLower) {
      return null;
    }

    return (
      memberEntries.find((member) => {
        const memberAddressLower = member.address?.toLowerCase();
        const memberInboxLower = member.inboxId.toLowerCase();
        return (
          (identityAddressLower && memberAddressLower === identityAddressLower) ||
          (identityInboxLower && memberInboxLower === identityInboxLower)
        );
      }) ?? null
    );
  }, [identityAddressLower, identityInboxLower, memberEntries]);

  const isCurrentUserSuperAdmin = useMemo(() => {
    if (!conversation?.isGroup) {
      return false;
    }

    if (currentMember?.isSuperAdmin) {
      return true;
    }

    if (
      typeof currentMember?.permissionLevel === 'number' &&
      currentMember.permissionLevel >= PermissionLevel.SuperAdmin
    ) {
      return true;
    }

    if (identityInboxLower && superAdminInboxSet.has(identityInboxLower)) {
      return true;
    }

    return false;
  }, [conversation?.isGroup, currentMember, identityInboxLower, superAdminInboxSet]);

  const isCurrentUserAdmin = useMemo(() => {
    if (!conversation?.isGroup) {
      return false;
    }

    if (isCurrentUserSuperAdmin) {
      return true;
    }

    if (identityAddressLower && adminAddressSet.has(identityAddressLower)) {
      return true;
    }

    if (identityInboxLower && adminInboxSet.has(identityInboxLower)) {
      return true;
    }

    if (!currentMember) {
      return false;
    }

    if (currentMember.isAdmin) {
      return true;
    }

    if (
      typeof currentMember.permissionLevel === 'number' &&
      currentMember.permissionLevel >= PermissionLevel.Admin
    ) {
      return true;
    }

    return false;
  }, [
    conversation?.isGroup,
    adminAddressSet,
    adminInboxSet,
    currentMember,
    identityAddressLower,
    identityInboxLower,
    isCurrentUserSuperAdmin,
  ]);

  const isCurrentUserMember = Boolean(currentMember);

  const canCurrentUserPerformPolicy = useCallback(
    (policy?: number | null) => {
      if (policy === PermissionPolicy.Allow) {
        return isCurrentUserMember;
      }
      if (policy === PermissionPolicy.Admin) {
        return isCurrentUserAdmin || isCurrentUserSuperAdmin;
      }
      if (policy === PermissionPolicy.SuperAdmin) {
        return isCurrentUserSuperAdmin;
      }
      if (policy === PermissionPolicy.Deny) {
        return false;
      }
      if (policy === PermissionPolicy.Other || policy === PermissionPolicy.DoesNotExist) {
        return isCurrentUserAdmin || isCurrentUserSuperAdmin;
      }
      return isCurrentUserAdmin || isCurrentUserSuperAdmin;
    },
    [isCurrentUserAdmin, isCurrentUserMember, isCurrentUserSuperAdmin],
  );

  const addMemberPolicy = conversation?.groupPermissions?.policySet?.addMemberPolicy;
  const removeMemberPolicy = conversation?.groupPermissions?.policySet?.removeMemberPolicy;
  const addAdminPolicy = conversation?.groupPermissions?.policySet?.addAdminPolicy;
  const removeAdminPolicy = conversation?.groupPermissions?.policySet?.removeAdminPolicy;

  const canCurrentUserAddMembers = useMemo(() => {
    if (!conversation?.isGroup) {
      return false;
    }
    if (addMemberPolicy === undefined || addMemberPolicy === null) {
      return isCurrentUserAdmin || isCurrentUserSuperAdmin;
    }
    return canCurrentUserPerformPolicy(addMemberPolicy);
  }, [
    addMemberPolicy,
    canCurrentUserPerformPolicy,
    conversation?.isGroup,
    isCurrentUserAdmin,
    isCurrentUserSuperAdmin,
  ]);

  const canCurrentUserRemoveMembers = useMemo(() => {
    if (!conversation?.isGroup) {
      return false;
    }
    if (removeMemberPolicy === undefined || removeMemberPolicy === null) {
      return isCurrentUserAdmin || isCurrentUserSuperAdmin;
    }
    return canCurrentUserPerformPolicy(removeMemberPolicy);
  }, [
    canCurrentUserPerformPolicy,
    conversation?.isGroup,
    isCurrentUserAdmin,
    isCurrentUserSuperAdmin,
    removeMemberPolicy,
  ]);

  const canCurrentUserPromoteMembers = useMemo(() => {
    if (!conversation?.isGroup) {
      return false;
    }
    if (addAdminPolicy === undefined || addAdminPolicy === null) {
      return isCurrentUserAdmin || isCurrentUserSuperAdmin;
    }
    return canCurrentUserPerformPolicy(addAdminPolicy);
  }, [
    addAdminPolicy,
    canCurrentUserPerformPolicy,
    conversation?.isGroup,
    isCurrentUserAdmin,
    isCurrentUserSuperAdmin,
  ]);

  const canCurrentUserDemoteAdmins = useMemo(() => {
    if (!conversation?.isGroup) {
      return false;
    }
    if (removeAdminPolicy === undefined || removeAdminPolicy === null) {
      return isCurrentUserAdmin || isCurrentUserSuperAdmin;
    }
    return canCurrentUserPerformPolicy(removeAdminPolicy);
  }, [
    canCurrentUserPerformPolicy,
    conversation?.isGroup,
    isCurrentUserAdmin,
    isCurrentUserSuperAdmin,
    removeAdminPolicy,
  ]);

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

    if (!canCurrentUserAddMembers) {
      setError('You do not have permission to add members.');
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
      const safeGroupImage = groupImage ? sanitizeImageSrc(groupImage) : null;
      if (groupImage && !safeGroupImage) {
        setError('Group avatar must be a https URL or a PNG/JPEG/GIF/WebP image.');
        setIsSaving(false);
        return;
      }

      const groupImageValue = safeGroupImage ?? '';
      // Enforce protocol constraints for image field length when using data URLs.
      // The XMTP group metadata field has a hard limit (~2048 chars). If the user pasted
      // a too-large base64 data URL directly, stop early with a helpful error instead
      // of attempting the network call that would fail.
      if (
        (groupImageValue || '').startsWith('data:') &&
        (groupImageValue || '').length > MAX_GROUP_IMAGE_CHARS
      ) {
        setError('Avatar too large for group metadata field. Please upload a smaller image or paste a hosted URL (<2048 chars).');
        setIsSaving(false);
        return;
      }

      const metadataPayload = {
        groupName: groupName || undefined,
        groupImage: groupImageValue || undefined,
        groupDescription: groupDescription || undefined,
      };
      const metadataChanged =
        (groupName || '') !== (conversation.groupName || '') ||
        (groupImageValue || '') !== (conversation.groupImage || '') ||
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

      // Re-fetch permissions to verify the latest state from the network
      try {
        await refreshGroupDetails(conversation.id);
      } catch (e) {
        // Non-fatal; UI will still reflect optimistic updates
      }

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

    if (!canCurrentUserAddMembers) {
      setError('You do not have permission to add members.');
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

    if (!canCurrentUserRemoveMembers) {
      setError('You do not have permission to remove members.');
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

    if (!canCurrentUserPromoteMembers) {
      setError('You do not have permission to promote members.');
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

    if (!canCurrentUserDemoteAdmins) {
      setError('You do not have permission to demote admins.');
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
    const safeAvatar = sanitizeImageSrc(avatar);
    if (safeAvatar) {
      return <img src={safeAvatar} alt="Contact avatar" className="w-full h-full rounded-full object-cover" />;
    }
    if (avatar) {
      return <span className="text-lg" aria-hidden>{avatar}</span>;
    }
    return <span className="text-white font-semibold" aria-hidden>{fallback.slice(0, 2).toUpperCase()}</span>;
  };

  const safeGroupImage = sanitizeImageSrc(groupImage);

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
          {canCurrentUserAddMembers && isContactPickerOpen && (
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

          {/* Group Avatar */}
          <div>
            <label htmlFor="groupImage" className="block text-sm font-medium mb-2">
              Group Avatar
            </label>
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-primary-700/70 flex items-center justify-center overflow-hidden">
                {safeGroupImage ? (
                  <img src={safeGroupImage} alt="Group Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-primary-200 text-sm">No avatar</span>
                )}
              </div>
              <div className="flex-1 flex items-center gap-2">
                <input
                  id="groupImage"
                  type="text"
                  value={groupImage}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Allow only blank or https image URLs for maximal safety to prevent XSS; block data:, javascript:, etc.
                    const safeCandidate = sanitizeImageSrc(value);
                    const isSafeImageUrl =
                      value === '' || (safeCandidate !== null && safeCandidate.startsWith('https://'));
                    if (isSafeImageUrl) {
                      setGroupImage(value);
                      setError('');
                    } else {
                      setError('Please enter a valid image URL (https only).');
                    }
                  }}
                  placeholder="Paste image URL or use Upload"
                  className="input-primary w-full"
                  disabled={!isCurrentUserAdmin}
                />
                <label className="btn-secondary cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={!isCurrentUserAdmin}
                    onChange={(e) => onGroupImageFileSelected(e.target.files?.[0])}
                  />
                  Upload
                </label>
                {groupImage && isCurrentUserAdmin && (
                  <button className="btn-secondary" onClick={() => setGroupImage('')}>Clear</button>
                )}
              </div>
            </div>
          </div>
          {error && (
            <div className="text-red-500 text-xs mt-2">{error}</div>
          )}

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
            {!canCurrentUserAddMembers && !canCurrentUserRemoveMembers && (
              <p className="text-sm text-primary-300 mb-4">
                You don&apos;t have permission to add or remove members in this group.
              </p>
            )}
            {canCurrentUserAddMembers && (
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
                  disabled={
                    !canCurrentUserAddMembers ||
                    (contactsLoading && availableContacts.length === 0)
                  }
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
                const safeMemberAvatar = sanitizeImageSrc(avatar);
                const avatarContent = safeMemberAvatar
                  ? <img src={safeMemberAvatar} alt="Member avatar" className="w-full h-full rounded-full object-cover" />
                  : avatar
                    ? <span className="text-lg" aria-hidden>{avatar}</span>
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
                  {(canCurrentUserPromoteMembers || canCurrentUserDemoteAdmins || canCurrentUserRemoveMembers) && (
                    <div className="flex gap-2">
                      {!member.isAdmin && canCurrentUserPromoteMembers && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => handlePromoteToAdmin(member)}
                        >
                          Promote
                        </button>
                      )}
                      {member.isAdmin && !isSelf && canCurrentUserDemoteAdmins && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => handleDemoteFromAdmin(member)}
                        >
                          Demote
                        </button>
                      )}
                      {!isSelf && canCurrentUserRemoveMembers && (
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

          {/* Danger Zone */}
          <div className="border-t border-primary-800/60 pt-4">
            <h2 className="text-lg font-semibold mb-2 text-red-300">Delete Group</h2>
            <p className="text-sm text-primary-300 mb-3">
              Deleting removes this group from the local device and adds it to the ignored list so it stays deleted after resyncs.
              You can rejoin later if you regain access to the group key material.
            </p>
            <button
              type="button"
              className="w-full btn-danger"
              onClick={async () => {
                if (!conversation) return;
                  if (!confirm('Delete this group? It will be removed locally and ignored during future resyncs.')) return;
                  try {
                    await deleteGroup(conversation.id);
                    navigate('/');
                  } catch (e) {
                    console.warn('[GroupSettings] Failed to delete local group data', e);
                  try {
                    // Fallback: local-only navigation; actual purge handled elsewhere
                    navigate('/');
                  } catch (_e) { /* ignore */ }
                }
              }}
            >
              Delete group
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
