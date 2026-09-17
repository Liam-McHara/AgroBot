import { describe, expect, it } from 'vitest';
import { renderNotification } from './render.js';

const env = { BOT_USERNAME: 'AgroBotTest', MINIAPP_SHORT_NAME: 'app' };
const applicantId = '11111111-1111-4111-8111-111111111111';

describe('N1 renderer (PRD N1)', () => {
  it('names the applicant and offers Approve / Reject in the admin language', () => {
    const rendered = renderNotification(
      env,
      'N1',
      { applicantId, name: 'Marta Puig', username: 'marta' },
      'es',
    );
    expect(rendered.text).toContain('Marta Puig (@marta)');
    expect(rendered.text).toContain('Nueva solicitud');
    const buttons = rendered.replyMarkup?.inline_keyboard.flat() ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['✅ Aprobar', '❌ Rechazar']);
    expect(buttons.map((b) => 'callback_data' in b && b.callback_data)).toEqual([
      `approve:${applicantId}`,
      `reject:${applicantId}`,
    ]);
  });

  it('escapes a name that looks like markup (ARCH §17)', () => {
    const rendered = renderNotification(
      env,
      'N1',
      { applicantId, name: '<b>Pau</b> & co', username: null },
      'ca',
    );
    expect(rendered.text).toContain('&lt;b&gt;Pau&lt;/b&gt; &amp; co');
    expect(rendered.text).not.toContain('(@');
  });
});

describe('N2 renderer (PRD N2)', () => {
  it('welcomes an approved applicant with an Open AgroBot link', () => {
    const rendered = renderNotification(env, 'N2', { decision: 'approved', name: 'Marta' }, 'ca');
    expect(rendered.text).toContain('Benvingut/da');
    const [button] = rendered.replyMarkup?.inline_keyboard.flat() ?? [];
    expect(button?.text).toBe("Obre l'AgroBot");
    expect('url' in button! && button.url).toBe('https://t.me/AgroBotTest/app');
  });

  it('tells a rejected applicant politely, with no button', () => {
    const rendered = renderNotification(env, 'N2', { decision: 'rejected', name: 'Marta' }, 'es');
    expect(rendered.text).toContain('no ha sido aceptada');
    expect(rendered.replyMarkup).toBeUndefined();
  });
});
