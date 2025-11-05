import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore, useContactStore } from '@/lib/stores';
import { useConversations } from '@/features/conversations/useConversations';
import { getAddress } from 'viem';

export function GroupSettingsPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const {
    conversations,
    updateGroupMetadata,
    addMembersToGroup,
    removeMembersFromGroup,
    promoteMemberToAdmin,
    demoteAdminToMember,
    refreshGroupDetails,
  } = useConversations();
  const { identity } = useAuthStore();
  const { contacts } = useContactStore();

  const conversation = conversations.find((c) => c.id === conversationId);
  const [groupName, setGroupName] = useState(conversation?.groupName || '');
  const [groupImage, setGroupImage] = useState(conversation?.groupImage || '');
  const [groupDescription, setGroupDescription] = useState(conversation?.groupDescription || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [newMemberAddress, setNewMemberAddress] = useState('');

  const isCurrentUserAdmin = conversation?.admins?.includes(identity?.address || '');
  const normalizedNewMemberAddress = useMemo(() => {
    try {
      if (!newMemberAddress.trim()) return null;
      return getAddress(newMemberAddress.trim() as `0x${string}`);
    } catch {
      return null;
    }
  }, [newMemberAddress]);

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

  if (!conversation || !conversation.isGroup) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-primary-50">
        <p>Group conversation not found or is not a group.</p>
        <button onClick={() => navigate(-1)} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  const handleSave = async () => {
    if (!isCurrentUserAdmin) {
      setError('Only group admins can update settings.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await updateGroupMetadata(conversation.id, {
        groupName: groupName || undefined,
        groupImage: groupImage || undefined,
        groupDescription: groupDescription || undefined,
      });

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

    if (conversation.members?.some((member) => member.toLowerCase() === normalizedNewMemberAddress.toLowerCase())) {
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

  const handleRemoveMember = async (memberAddress: string) => {
    setError('');

    if (!isCurrentUserAdmin) {
      setError('Only group admins can remove members.');
      return;
    }
    if (window.confirm(`Are you sure you want to remove ${memberAddress}?`)) {
      try {
        await removeMembersFromGroup(conversation.id, [memberAddress]);
        alert('Member removed!');
      } catch (err) {
        console.error('Failed to remove member:', err);
        setError('Failed to remove member. Please try again.');
      }
    }
  };

  const handlePromoteToAdmin = async (memberAddress: string) => {
    setError('');

    if (!isCurrentUserAdmin) {
      setError('Only group admins can promote members.');
      return;
    }
    try {
      await promoteMemberToAdmin(conversation.id, memberAddress);
      alert('Member promoted to admin!');
    } catch (err) {
      console.error('Failed to promote member:', err);
      setError('Failed to promote member. Please try again.');
    }
  };

  const handleDemoteFromAdmin = async (adminAddress: string) => {
    setError('');

    if (!isCurrentUserAdmin) {
      setError('Only group admins can demote admins.');
      return;
    }
    if (window.confirm(`Are you sure you want to demote ${adminAddress}?`)) {
      try {
        await demoteAdminToMember(conversation.id, adminAddress);
        alert('Admin demoted to member!');
      } catch (err) {
        console.error('Failed to demote admin:', err);
        setError('Failed to demote admin. Please try again.');
      }
    }
  };

  const getContactName = (address: string) => {
    const contact = contacts.find(c => c.address === address);
    return contact ? contact.name : `${address.slice(0, 6)}...${address.slice(-4)}`;
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

          {/* Member Management */}
          <div>
            <h2 className="text-lg font-semibold mb-2">Member Management</h2>
            {isCurrentUserAdmin && (
              <div className="flex gap-2 mb-4">
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
                    conversation.members?.some(
                      (member) => member.toLowerCase() === normalizedNewMemberAddress.toLowerCase()
                    )
                  }
                >
                  Add
                </button>
              </div>
            )}
            <ul className="bg-primary-900/70 rounded-lg p-3 space-y-2">
              {conversation.members?.map((member) => (
                <li key={member} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-primary-800/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-700 flex items-center justify-center text-sm font-semibold">
                      {member.slice(2, 4).toUpperCase()}
                    </div>
                    <span className="text-primary-50">{getContactName(member)}</span>
                    {conversation.admins?.includes(member) && (
                      <span className="text-accent-300 text-xs px-2 py-0.5 bg-accent-900 rounded-full">Admin</span>
                    )}
                  </div>
                  {isCurrentUserAdmin && ( // Only show management buttons if current user is admin
                    <div className="flex gap-2">
                      {!conversation.admins?.includes(member) && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => handlePromoteToAdmin(member)}
                        >
                          Promote
                        </button>
                      )}
                      {conversation.admins?.includes(member) && member !== identity?.address && (
                        <button
                          className="btn-secondary btn-xs"
                          onClick={() => handleDemoteFromAdmin(member)}
                        >
                          Demote
                        </button>
                      )}
                      {member !== identity?.address && (
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
              ))}
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
              Share this link with others to invite them to this group.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
