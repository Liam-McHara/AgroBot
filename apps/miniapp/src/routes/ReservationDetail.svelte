<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { push } from 'svelte-spa-router';
  import {
    formatters,
    MESSAGE_MAX_LENGTH,
    REASON_MAX_LENGTH,
    type MessageView,
    type ReservationAction,
    type ReservationDetailView,
  } from '@agrobot/shared';
  import { ApiError } from '../lib/api/client.js';
  import { actOnReservation, fetchReservation } from '../lib/api/reservations.js';
  import { postMessage, readThread } from '../lib/api/threads.js';
  import ReservationSummary from '../lib/components/reservations/ReservationSummary.svelte';
  import Screen from '../lib/components/Screen.svelte';
  import { language, t } from '../lib/i18n/index.svelte.js';
  import { ACTIONS_WITH_REASON } from '../lib/reservations.js';
  import { meStore } from '../lib/stores/me.svelte.js';
  import { realtime } from '../lib/stores/realtime.svelte.js';
  import { toasts } from '../lib/stores/toast.svelte.js';
  import { haptic, openInTelegram } from '../lib/telegram.js';
  import { loadThread, mergeMessage, stampStyle, systemLine, telegramLink } from '../lib/thread.js';

  /**
   * ARCH §12 `/reservations/:id`, the target of the `r_<id>` deep link (ARCH §4): the
   * reservation with its context and the actions ARCH §6 allows me right now, straight from
   * the API so the screen never guesses at the state machine; under it, the thread (PRD
   * US-5.1, ADR-0005). Confirm is one tap; the closing actions ask once, and reject/cancel
   * take an optional reason (PRD US-4.2, US-4.3). *Confirm and mark delivered* is the
   * producer's one-tap handover (ADR-0014).
   *
   * The thread is refetched whole on `message.new` and `reservation.changed` (ARCH §7) and
   * marked read each time, which clears the badge and re-arms the N9 throttle (ARCH §8);
   * while this screen is open the socket says so (`viewing`), so no N9 is queued at all. A
   * sent message shows at once and is replaced by the server's copy (optimistic send).
   */
  let { params }: { params: { id: string } } = $props();

  let reservation = $state<ReservationDetailView | null>(null);
  let loading = $state(true);
  let missing = $state(false);
  let busy = $state(false);
  /** Every action but a plain confirm asks once; this is the one awaiting the answer. */
  type ConfirmableAction = Exclude<ReservationAction, 'confirm'>;
  let pending = $state<ConfirmableAction | null>(null);
  let reason = $state('');

  let messages = $state<MessageView[]>([]);
  /** Sent, not yet acknowledged: shown last, in the sender's bubble, until the server answers. */
  let outgoing = $state<Array<{ key: number; body: string }>>([]);
  let draft = $state('');
  let end = $state<HTMLElement | null>(null);
  let threadRequest = 0;
  let outgoingKey = 0;

  const writable = $derived(reservation?.thread.writable ?? false);
  const telegramUrl = $derived(reservation ? telegramLink(reservation.counterpart.username) : null);
  const readonlyDays = $derived(meStore.me?.settings.thread_readonly_days_after_close ?? 7);

  async function load(): Promise<void> {
    try {
      reservation = (await fetchReservation(params.id)).reservation;
      missing = false;
    } catch (error) {
      missing = true;
      toasts.error(error);
    } finally {
      loading = false;
    }
  }

  async function loadMessages(): Promise<void> {
    const current = ++threadRequest;
    try {
      const loaded = await loadThread(params.id);
      if (current !== threadRequest) return;
      messages = loaded;
      await markRead();
      await scrollToEnd();
    } catch (error) {
      if (current === threadRequest) toasts.error(error);
    }
  }

  /** ARCH §8 step 3: everything shown counts as read; the badges follow at once. */
  async function markRead(): Promise<void> {
    try {
      meStore.applyUnread((await readThread(params.id)).unread);
    } catch {
      /* the badge catches up on the next `/me` */
    }
  }

  async function scrollToEnd(): Promise<void> {
    await tick();
    end?.scrollIntoView?.({ block: 'end' });
  }

  onMount(() => {
    void load();
    void loadMessages();
    realtime.setViewing(params.id);
    const refresh = () => {
      void load();
      void loadMessages();
    };
    const unsubscribe = [
      realtime.on('reservation.changed', (event) => {
        if (event.type === 'reservation.changed' && event.id === params.id) refresh();
      }),
      realtime.on('message.new', (event) => {
        if (event.type === 'message.new' && event.reservationId === params.id) {
          void loadMessages();
        }
      }),
      realtime.onReconnect(refresh),
    ];
    return () => {
      for (const off of unsubscribe) off();
      realtime.setViewing(null);
    };
  });

  const takesReason = (action: ReservationAction) =>
    (ACTIONS_WITH_REASON as readonly string[]).includes(action);

  function start(action: ReservationAction): void {
    if (action === 'confirm') {
      void run(action);
    } else {
      pending = action;
      reason = '';
    }
  }

  async function run(action: ReservationAction): Promise<void> {
    if (!reservation) return;
    busy = true;
    try {
      const trimmed = reason.trim();
      const body = takesReason(action) && trimmed !== '' ? { reason: trimmed } : {};
      reservation = (await actOnReservation(reservation.id, action, body)).reservation;
      pending = null;
      haptic('success');
      toasts.success(t(`reservation.done.${action}`));
      // The transition wrote a system line; the socket will say so too, but why wait.
      void loadMessages();
    } catch (error) {
      haptic('error');
      toasts.error(error);
      // A stale screen: someone else moved it meanwhile; show where it stands now.
      if (error instanceof ApiError && error.code === 'INVALID_TRANSITION') void load();
    } finally {
      busy = false;
    }
  }

  async function send(): Promise<void> {
    const body = draft.trim();
    if (body === '' || !writable) return;
    const key = ++outgoingKey;
    outgoing = [...outgoing, { key, body }];
    draft = '';
    await scrollToEnd();
    try {
      const { message } = await postMessage(params.id, body);
      messages = mergeMessage(messages, message);
      outgoing = outgoing.filter((item) => item.key !== key);
      await scrollToEnd();
    } catch (error) {
      outgoing = outgoing.filter((item) => item.key !== key);
      if (draft === '') draft = body;
      haptic('error');
      toasts.error(error);
      if (error instanceof ApiError && error.code === 'THREAD_READONLY') void load();
    }
  }

  function onComposerKey(event: KeyboardEvent): void {
    // Enter alone is a new line on a phone keyboard; Ctrl/⌘+Enter sends from a desktop.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  }

  function onTelegramLink(event: MouseEvent): void {
    if (telegramUrl && openInTelegram(telegramUrl)) event.preventDefault();
  }

  const stamp = (createdAt: string) =>
    stampStyle(createdAt) === 'time'
      ? formatters.time(language(), createdAt)
      : formatters.datetime(language(), createdAt);
</script>

<Screen title={t('reservation.title')}>
  {#if loading}
    <p class="hint" role="status">{t('common.loading')}</p>
  {:else if missing || !reservation}
    <p class="hint">{t('reservation.not_found')}</p>
    <button type="button" class="secondary" onclick={() => void push('/reservations')}
      >{t('nav.reservations')}</button
    >
  {:else}
    <div class="card" data-testid="reservation-detail" data-status={reservation.status}>
      <ReservationSummary {reservation} detail />
      {#if reservation.offer.note}
        <p class="hint">{t('reservation.offer_note', { note: reservation.offer.note })}</p>
      {/if}
      {#if reservation.offer.status !== 'active' && (reservation.status === 'pending' || reservation.status === 'confirmed')}
        <p class="hint">{t(`reservation.offer_gone.${reservation.offer.status}`)}</p>
      {/if}
      {#if telegramUrl}
        <a
          class="telegram"
          href={telegramUrl}
          target="_blank"
          rel="noopener"
          data-testid="open-in-telegram"
          onclick={onTelegramLink}>{t('thread.open_in_telegram')}</a
        >
      {/if}
    </div>

    {#if pending}
      <div class="confirm" data-testid="action-confirm">
        <p>{t(`reservation.confirm.${pending}`)}</p>
        {#if takesReason(pending)}
          <label
            >{t('reservation.reason_label')}
            <textarea bind:value={reason} maxlength={REASON_MAX_LENGTH} rows="2" disabled={busy}
            ></textarea>
          </label>
        {/if}
        <div class="actions">
          <button
            type="button"
            class={pending === 'deliver' || pending === 'confirm-and-deliver' ? '' : 'danger'}
            disabled={busy}
            onclick={() => pending && run(pending)}>{t(`reservation.action.${pending}`)}</button
          >
          <button type="button" class="secondary" disabled={busy} onclick={() => (pending = null)}
            >{t('common.cancel')}</button
          >
        </div>
      </div>
    {:else if reservation.actions.length > 0}
      <div class="actions" data-testid="reservation-actions">
        {#each reservation.actions as action (action)}
          <button
            type="button"
            class={action === 'reject' || action === 'cancel' ? 'danger' : ''}
            disabled={busy}
            onclick={() => start(action)}>{t(`reservation.action.${action}`)}</button
          >
        {/each}
        {#if reservation.actions.includes('confirm-and-deliver')}
          <p class="hint">{t('reservation.action.confirm-and-deliver_hint')}</p>
        {/if}
      </div>
    {/if}

    <section class="thread" aria-label={t('thread.heading')} data-testid="thread">
      <h2>{t('thread.heading')}</h2>
      {#if messages.every((m) => m.kind === 'system') && outgoing.length === 0}
        <p class="hint">{t('thread.empty')}</p>
      {/if}
      <ol class="messages">
        {#each messages as message (message.id)}
          {#if message.kind === 'system'}
            <li class="system" data-testid="system-line">
              {#if message.meta}
                {@const line = systemLine(message.meta)}
                <span>{t(line.key, line.params)}</span>
                {#if message.meta.reason}
                  <span>· {t('reservation.reason', { reason: message.meta.reason })}</span>
                {/if}
              {:else}
                <span>{message.body}</span>
              {/if}
              <time datetime={message.createdAt}>{stamp(message.createdAt)}</time>
            </li>
          {:else}
            <li
              class="bubble"
              class:mine={message.mine}
              data-testid="message"
              data-mine={message.mine}
            >
              {#if !message.mine && message.sender}
                <span class="sender">{message.sender.displayName}</span>
              {/if}
              <p class="body">{message.body}</p>
              <time datetime={message.createdAt}>{stamp(message.createdAt)}</time>
            </li>
          {/if}
        {/each}
        {#each outgoing as item (item.key)}
          <li
            class="bubble mine pending"
            data-testid="message"
            data-mine="true"
            data-pending="true"
          >
            <p class="body">{item.body}</p>
            <span class="stamp">{t('thread.sending')}</span>
          </li>
        {/each}
      </ol>
      <div bind:this={end}></div>

      {#if writable}
        {#if reservation.thread.writableUntil}
          <p class="hint">
            {t('thread.writable_until', { when: reservation.thread.writableUntil })}
          </p>
        {/if}
        <form
          class="composer"
          onsubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label class="composer-label" for="composer">{t('thread.composer.label')}</label>
          <textarea
            id="composer"
            bind:value={draft}
            placeholder={t('thread.composer.placeholder')}
            maxlength={MESSAGE_MAX_LENGTH}
            rows="2"
            onkeydown={onComposerKey}></textarea>
          <button type="submit" data-testid="send" disabled={draft.trim() === ''}
            >{t('thread.composer.send')}</button
          >
        </form>
      {:else}
        <p class="banner" data-testid="thread-readonly">
          {t('thread.readonly', { count: readonlyDays })}
        </p>
      {/if}
    </section>
  {/if}
</Screen>

<style>
  .card,
  .confirm,
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card,
  .confirm {
    padding: 12px;
    background: var(--agrobot-secondary-bg);
    border-radius: var(--agrobot-radius);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions .hint {
    flex-basis: 100%;
  }
  textarea {
    min-height: var(--agrobot-touch-target);
    width: 100%;
    padding: 10px;
    font: inherit;
    border: 1px solid var(--agrobot-hint);
    border-radius: var(--agrobot-radius);
    color: var(--agrobot-text);
    background: var(--agrobot-bg);
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--agrobot-hint);
    font-size: 0.9rem;
  }
  button[disabled] {
    opacity: 0.5;
  }
  .telegram {
    align-self: flex-start;
    color: var(--agrobot-link);
    font-weight: 600;
    min-height: var(--agrobot-touch-target);
    display: inline-flex;
    align-items: center;
  }

  .thread {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .messages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bubble {
    align-self: flex-start;
    max-width: 85%;
    padding: 8px 12px;
    border-radius: var(--agrobot-radius);
    background: var(--agrobot-secondary-bg);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bubble.mine {
    align-self: flex-end;
    background: var(--agrobot-button);
    color: var(--agrobot-button-text);
  }
  .bubble.pending {
    opacity: 0.7;
  }
  .sender {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--agrobot-link);
  }
  .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .bubble time,
  .stamp {
    align-self: flex-end;
    font-size: 0.7rem;
    opacity: 0.75;
  }
  .system {
    align-self: center;
    text-align: center;
    font-size: 0.85rem;
    color: var(--agrobot-hint);
    padding: 4px 8px;
  }
  .system time {
    display: block;
    font-size: 0.7rem;
  }
  .composer {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .composer textarea {
    flex: 1;
    resize: none;
  }
  .composer-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .banner {
    padding: 10px 12px;
    border-radius: var(--agrobot-radius);
    background: var(--agrobot-secondary-bg);
    color: var(--agrobot-hint);
    font-size: 0.9rem;
  }
</style>
