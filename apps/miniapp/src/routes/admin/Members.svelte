<script lang="ts">
  import { onMount } from 'svelte';
  import {
    parseInviteIdentifier,
    type AdminMember,
    type Invite,
    type MemberAction,
  } from '@agrobot/shared';
  import Screen from '../../lib/components/Screen.svelte';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { meStore } from '../../lib/stores/me.svelte.js';
  import { toasts } from '../../lib/stores/toast.svelte.js';
  import { haptic } from '../../lib/telegram.js';
  import {
    adminCreateInvite,
    adminDeleteInvite,
    adminListInvites,
    adminListMembers,
    adminMemberAction,
  } from '../../lib/api/members.js';

  /** PRD §10 "Members": applicants (US-1.2), members (US-1.4), pre-approvals (US-1.3). */
  type Tab = 'applicants' | 'members' | 'invites';
  const TABS: Tab[] = ['applicants', 'members', 'invites'];

  let tab = $state<Tab>('applicants');
  let members = $state<AdminMember[]>([]);
  let invites = $state<Invite[]>([]);
  let loading = $state(true);
  let showRejected = $state(false);
  let busy = $state<string | null>(null);
  let identifier = $state('');

  const applicants = $derived(members.filter((m) => m.status === 'pending'));
  const roster = $derived(
    members
      .filter(
        (m) =>
          m.status === 'approved' ||
          m.status === 'suspended' ||
          (showRejected && m.status === 'rejected'),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  const identifierValid = $derived(parseInviteIdentifier(identifier) !== null);

  async function load(): Promise<void> {
    try {
      const [membersResponse, invitesResponse] = await Promise.all([
        adminListMembers(),
        adminListInvites(),
      ]);
      members = membersResponse.members;
      invites = invitesResponse.invites;
    } catch (error) {
      toasts.error(error);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  async function act(member: AdminMember, action: MemberAction): Promise<void> {
    busy = member.id;
    try {
      const { member: updated } = await adminMemberAction(member.id, action);
      members = members.map((m) => (m.id === updated.id ? updated : m));
      haptic('success');
      if (updated.id === meStore.me?.id) void meStore.refetch();
    } catch (error) {
      haptic('error');
      toasts.error(error);
    } finally {
      busy = null;
    }
  }

  async function addInvite(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!identifierValid) {
      toasts.show('error', t('admin.invites.invalid'));
      return;
    }
    busy = 'invite';
    try {
      const { invite } = await adminCreateInvite({ identifier: identifier.trim() });
      invites = [invite, ...invites];
      identifier = '';
      haptic('success');
      // The invite may have let a waiting applicant in (US-1.3).
      if (invite.usedAt) void load();
    } catch (error) {
      haptic('error');
      toasts.error(error);
    } finally {
      busy = null;
    }
  }

  async function removeInvite(invite: Invite): Promise<void> {
    busy = invite.id;
    try {
      await adminDeleteInvite(invite.id);
      invites = invites.filter((i) => i.id !== invite.id);
    } catch (error) {
      toasts.error(error);
    } finally {
      busy = null;
    }
  }

  /** US-1.4: which buttons a row gets, from its current state. */
  function actionsFor(member: AdminMember): MemberAction[] {
    switch (member.status) {
      case 'pending':
        return ['approve', 'reject'];
      case 'rejected':
        return ['approve'];
      case 'suspended':
        return ['reinstate', ...(member.role === 'admin' ? (['demote'] as const) : [])];
      case 'approved':
        return [member.role === 'admin' ? 'demote' : 'promote', 'suspend'];
    }
  }

  const handle = (member: AdminMember) =>
    member.username ? `@${member.username}` : `id ${member.telegramId}`;
</script>

<Screen title={t('admin.members.title')}>
  <div class="tabs" role="tablist">
    {#each TABS as candidate (candidate)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === candidate}
        class:selected={tab === candidate}
        onclick={() => (tab = candidate)}
      >
        {t(`admin.members.tab.${candidate}`)}
        {#if candidate === 'applicants' && applicants.length > 0}
          <span class="badge">{applicants.length}</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if loading}
    <p class="hint">{t('common.loading')}</p>
  {:else if tab === 'applicants'}
    {#if applicants.length === 0}
      <p class="hint">{t('admin.members.empty.applicants')}</p>
    {/if}
    <ul>
      {#each applicants as member (member.id)}
        <li data-testid="applicant" data-member-id={member.id}>
          <div class="who">
            <strong>{member.displayName}</strong>
            <span class="hint">{handle(member)}</span>
            <span class="hint">{t('admin.members.applied_at', { when: member.appliedAt })}</span>
          </div>
          <div class="actions">
            {#each actionsFor(member) as action (action)}
              <button
                type="button"
                class:danger={action === 'reject'}
                disabled={busy === member.id}
                onclick={() => act(member, action)}
              >
                {t(`admin.members.action.${action}`)}
              </button>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  {:else if tab === 'members'}
    <label class="toggle">
      <input type="checkbox" bind:checked={showRejected} />
      {t('admin.members.filter.rejected')}
    </label>
    {#if roster.length === 0}
      <p class="hint">{t('admin.members.empty.members')}</p>
    {/if}
    <ul>
      {#each roster as member (member.id)}
        <li data-testid="member" data-status={member.status}>
          <div class="who">
            <strong>
              {member.displayName}
              {#if member.id === meStore.me?.id}<span class="hint">{t('common.you')}</span>{/if}
            </strong>
            <span class="hint">
              {handle(member)} · {t(`member.role.${member.role}`)} · {t(
                `member.status.${member.status}`,
              )}
            </span>
            {#if member.lastSeenAt}
              <span class="hint">{t('admin.members.last_seen', { when: member.lastSeenAt })}</span>
            {/if}
          </div>
          <div class="actions">
            {#each actionsFor(member) as action (action)}
              <button
                type="button"
                class:danger={action === 'suspend'}
                class:secondary={action !== 'suspend'}
                disabled={busy === member.id}
                onclick={() => act(member, action)}
              >
                {t(`admin.members.action.${action}`)}
              </button>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">{t('admin.invites.hint')}</p>
    <form class="invite" onsubmit={addInvite}>
      <input
        type="text"
        bind:value={identifier}
        placeholder={t('admin.invites.placeholder')}
        aria-label={t('admin.invites.placeholder')}
        autocapitalize="off"
        autocorrect="off"
      />
      <button type="submit" disabled={busy === 'invite' || identifier.trim() === ''}>
        {t('admin.invites.add')}
      </button>
    </form>
    {#if invites.length === 0}
      <p class="hint">{t('admin.members.empty.invites')}</p>
    {/if}
    <ul>
      {#each invites as invite (invite.id)}
        <li data-testid="invite">
          <div class="who">
            <strong>{invite.username ? `@${invite.username}` : `id ${invite.telegramId}`}</strong>
            {#if invite.createdByName}
              <span class="hint">{t('admin.invites.added_by', { name: invite.createdByName })}</span
              >
            {/if}
            {#if invite.usedByName}
              <span class="hint">{t('admin.invites.used_by', { name: invite.usedByName })}</span>
            {/if}
          </div>
          {#if !invite.usedAt}
            <div class="actions">
              <button
                type="button"
                class="secondary"
                disabled={busy === invite.id}
                onclick={() => removeInvite(invite)}
              >
                {t('admin.invites.remove')}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Screen>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
  }

  .tabs button {
    flex: 1;
    background: transparent;
    color: var(--agrobot-text);
    padding: 0 8px;
    font-size: 0.9rem;
  }

  .tabs button.selected {
    background: var(--agrobot-button);
    color: var(--agrobot-button-text);
  }

  .badge {
    display: inline-block;
    min-width: 1.4em;
    padding: 0 0.4em;
    margin-left: 4px;
    border-radius: 999px;
    background: var(--agrobot-destructive);
    color: #fff;
    font-size: 0.75rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: var(--agrobot-radius);
    background: var(--agrobot-secondary-bg);
  }

  .who {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .actions button {
    flex: 1;
    font-size: 0.9rem;
  }

  .hint {
    margin: 0;
    color: var(--agrobot-hint);
    font-size: 0.85rem;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--agrobot-touch-target);
    color: var(--agrobot-hint);
  }

  .invite {
    display: flex;
    gap: 8px;
  }

  .invite input {
    flex: 1;
    min-height: var(--agrobot-touch-target);
    padding: 0 12px;
    border: 1px solid rgb(0 0 0 / 0.12);
    border-radius: var(--agrobot-radius);
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-text);
    font: inherit;
  }

  button[disabled] {
    opacity: 0.5;
  }
</style>
